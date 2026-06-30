import {
  BadRequestException,
  Body,
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
import { CodigoAsistencia } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel } from '../../common/scope';
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

@Injectable()
export class AsistenciaService {
  constructor(private readonly prisma: PrismaService) {}

  private async cursoConAcceso(user: JwtPayload, cursoId: string) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    return curso;
  }

  async capturar(user: JwtPayload, cursoId: string, dto: CapturarAsistenciaDto) {
    const curso = await this.cursoConAcceso(user, cursoId);
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

    await this.prisma.$transaction(
      dto.registros.map((r) =>
        this.prisma.asistencia.upsert({
          where: { cadeteMatricula_cursoId_fecha: { cadeteMatricula: r.cadeteMatricula, cursoId, fecha } },
          create: { cadeteMatricula: r.cadeteMatricula, cursoId, fecha, codigo: r.codigo, capturadaPor: user.sub },
          update: { codigo: r.codigo, capturadaPor: user.sub, capturadaEn: new Date() },
        }),
      ),
    );

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

    const filas = await this.prisma.asistencia.groupBy({
      by: ['cadeteMatricula', 'codigo'],
      where: { cursoId, fecha: { gte: parcial.fechaInicio!, lte: parcial.fechaFin! } },
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
  porFecha(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Query('fecha') fecha: string) {
    return this.asistencia.porFecha(user, cursoId, fecha);
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
