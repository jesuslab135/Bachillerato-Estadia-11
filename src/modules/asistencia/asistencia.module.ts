import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsIn, IsString, MinLength, ValidateNested } from 'class-validator';
import { CodigoAsistencia, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, aseguraEscrituraDocente } from '../../common/scope';
import { ESTADOS_BLOQUEADOS, ventanaDeParcial } from '../../common/parcial';
import { esSDE, porcentajeAsistencia, tieneDerechoExamen } from '../../domain';

const CODIGOS: CodigoAsistencia[] = ['A', 'F', 'R', 'J'];

class RegistroAsistenciaDto {
  @IsString() @MinLength(1) cadeteMatricula!: string;
  @IsIn(CODIGOS) codigo!: CodigoAsistencia;
}

class CapturarAsistenciaDto {
  @IsDateString() fecha!: string;
  @ValidateNested({ each: true })
  @Type(() => RegistroAsistenciaDto)
  @ArrayMinSize(1)
  registros!: RegistroAsistenciaDto[];
}

// FB-B-7 — la fecha de consulta se valida con DTO (antes: Invalid Date → 500).
class FechaQueryDto {
  @IsDateString() fecha!: string;
}

@Injectable()
export class AsistenciaService {
  constructor(private readonly prisma: PrismaService) {}

  private async cursoConAcceso(user: JwtPayload, cursoId: string) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    return curso;
  }

  /**
   * FB-B-3 / RN-06 — La asistencia cuya fecha cae en la ventana de un parcial
   * CerradoDocente/Validado es inmutable (alterarla cambiaría SDE y el acta).
   * Fechas fuera de toda ventana de parcial se permiten (comportamiento actual).
   */
  private async asegurarVentanaEditable(tx: Prisma.TransactionClient, cursoId: string, fecha: Date) {
    const parcial = await tx.parcial.findFirst({
      where: { cursoId, fechaInicio: { lte: fecha }, fechaFin: { gte: fecha } },
      select: { numero: true, estado: true },
    });
    if (parcial && ESTADOS_BLOQUEADOS.includes(parcial.estado)) {
      throw new ConflictException(
        `La fecha cae en el parcial ${parcial.numero} (${parcial.estado}): la asistencia es inmutable y requiere reapertura formal (RN-06)`,
      );
    }
  }

  async capturar(user: JwtPayload, cursoId: string, dto: CapturarAsistenciaDto) {
    const curso = await this.cursoConAcceso(user, cursoId);
    aseguraEscrituraDocente(user, curso.docenteId); // FB-B-6
    const fecha = new Date(dto.fecha);

    const matriculas = dto.registros.map((r) => r.cadeteMatricula);
    const cadetes = await this.prisma.cadete.findMany({ where: { matricula: { in: matriculas } } });
    const porMatricula = new Map(cadetes.map((c) => [c.matricula, c]));

    for (const r of dto.registros) {
      const cadete = porMatricula.get(r.cadeteMatricula);
      if (!cadete) throw new BadRequestException(`Cadete ${r.cadeteMatricula} no existe`);
      if (cadete.grupoActualId !== curso.grupoId) {
        throw new BadRequestException(`Cadete ${r.cadeteMatricula} no pertenece al grupo del curso`);
      }
      // RN-05: en baja definitiva no se registran nuevas asistencias.
      if (cadete.estatus === 'BajaDefinitiva') {
        throw new BadRequestException(`Cadete ${r.cadeteMatricula} está en baja definitiva`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-aserción dentro de la transacción: el parcial pudo cerrarse entre el check y el write.
      await this.asegurarVentanaEditable(tx, cursoId, fecha);
      // FB-B-9 — el cambio de código (p. ej. F→J, RN-01-sensible) deja rastro; la captura
      // inicial y el upsert idéntico no generan ruido en bitácora.
      const previas = new Map(
        (await tx.asistencia.findMany({ where: { cursoId, fecha, cadeteMatricula: { in: matriculas } } })).map((a) => [
          a.cadeteMatricula,
          a,
        ]),
      );
      for (const r of dto.registros) {
        const antes = previas.get(r.cadeteMatricula);
        const fila = await tx.asistencia.upsert({
          where: { cadeteMatricula_cursoId_fecha: { cadeteMatricula: r.cadeteMatricula, cursoId, fecha } },
          create: { cadeteMatricula: r.cadeteMatricula, cursoId, fecha, codigo: r.codigo, capturadaPor: user.sub },
          update: { codigo: r.codigo, capturadaPor: user.sub, capturadaEn: new Date() },
        });
        if (antes && antes.codigo !== r.codigo) {
          await tx.auditLog.create({
            data: {
              tipoEvento: 'ASISTENCIA_CAMBIO_CODIGO',
              usuarioId: user.sub,
              entidad: 'Asistencia',
              entidadId: fila.id,
              valorAnteriorJson: { codigo: antes.codigo },
              valorNuevoJson: { codigo: r.codigo, cadeteMatricula: r.cadeteMatricula, cursoId, fecha: dto.fecha },
            },
          });
        }
      }
    });

    return { capturados: dto.registros.length };
  }

  async porFecha(user: JwtPayload, cursoId: string, fecha: string) {
    await this.cursoConAcceso(user, cursoId);
    return this.prisma.asistencia.findMany({ where: { cursoId, fecha: new Date(fecha) } });
  }

  /**
   * RF-ASIS-03 + RF-ASIS-04 — Contadores en tiempo real y bandera SDE por cadete,
   * dentro de la ventana de fechas del parcial. Recalcular siempre (la corrección
   * F→J restituye el derecho automáticamente, RF-ASIS-08).
   */
  async resumenParcial(user: JwtPayload, cursoId: string, numero: number) {
    const curso = await this.cursoConAcceso(user, cursoId);
    if (![1, 2, 3].includes(numero)) throw new BadRequestException('Parcial debe ser 1, 2 o 3');
    const parcial = await this.prisma.parcial.findUniqueOrThrow({
      where: { cursoId_numero: { cursoId, numero } },
    });
    const cadetes = await this.prisma.cadete.findMany({
      where: { grupoActualId: curso.grupoId },
      orderBy: { nombreCompleto: 'asc' },
    });

    const ventana = ventanaDeParcial(parcial); // FB-B-7: 409 si la ventana es nula
    const filas = await this.prisma.asistencia.groupBy({
      by: ['cadeteMatricula', 'codigo'],
      where: { cursoId, fecha: { gte: ventana.inicio, lte: ventana.fin } },
      _count: { _all: true },
    });
    const conteos = new Map<string, { A: number; F: number; R: number; J: number }>();
    for (const f of filas) {
      const c = conteos.get(f.cadeteMatricula) ?? { A: 0, F: 0, R: 0, J: 0 };
      c[f.codigo] = f._count._all;
      conteos.set(f.cadeteMatricula, c);
    }

    return {
      parcial: numero,
      cadetes: cadetes.map((cadete) => {
        const c = conteos.get(cadete.matricula) ?? { A: 0, F: 0, R: 0, J: 0 };
        return {
          matricula: cadete.matricula,
          nombreCompleto: cadete.nombreCompleto,
          estatus: cadete.estatus,
          total: c.A + c.F + c.R + c.J,
          asistencias: c.A,
          retardos: c.R,
          faltas: c.F,
          justificadas: c.J,
          porcentajeAsistencia: porcentajeAsistencia(c),
          tieneDerechoExamen: tieneDerechoExamen(c.F),
          sde: esSDE(c.F),
        };
      }),
    };
  }
}

@Controller('cursos/:cursoId')
export class AsistenciaController {
  constructor(private readonly asistencia: AsistenciaService) {}

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('asistencia')
  @HttpCode(HttpStatus.OK)
  capturar(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Body() dto: CapturarAsistenciaDto) {
    return this.asistencia.capturar(user, cursoId, dto);
  }

  @Get('asistencia')
  porFecha(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Query() q: FechaQueryDto) {
    return this.asistencia.porFecha(user, cursoId, q.fecha);
  }

  @Get('parciales/:numero/resumen')
  resumen(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string) {
    return this.asistencia.resumenParcial(user, cursoId, Number(numero));
  }
}

@Module({
  controllers: [AsistenciaController],
  providers: [AsistenciaService],
})
export class AsistenciaModule {}
