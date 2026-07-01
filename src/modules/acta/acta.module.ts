import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { TipoExamen } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel } from '../../common/scope';
import { CalificacionModule, CalificacionService } from '../calificacion/calificacion.module';
import {
  CALIF_MAX,
  CALIF_MIN,
  EntradaSemestre,
  InstanciaRecuperacion,
  NotaParcial,
  calificacionFinalSemestre,
  observacionSemestral,
} from '../../domain';

const TIPOS_RECUPERACION: TipoExamen[] = ['Ordinario', 'Extraordinario', 'TDS'];

class RecuperacionDto {
  @IsString() @MinLength(1) cadeteMatricula!: string;
  @IsIn(TIPOS_RECUPERACION) tipo!: TipoExamen;
  @IsOptional() @IsNumber() @Min(CALIF_MIN) @Max(CALIF_MAX) valor?: number;
  @IsOptional() np?: boolean;
}

interface FilaActa {
  matricula: string;
  nombreCompleto: string;
  parciales: [NotaParcial, NotaParcial, NotaParcial];
  ordinario: InstanciaRecuperacion;
  extraordinario: InstanciaRecuperacion;
  tds: InstanciaRecuperacion;
  observacion: string;
  calificacionFinal: number;
}

@Injectable()
export class ActaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calif: CalificacionService,
  ) {}

  private async cursoConAcceso(user: JwtPayload, cursoId: string) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    return curso;
  }

  private async parcial3(cursoId: string) {
    return this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 3 } } });
  }

  private async actaVigente(cursoId: string) {
    return this.prisma.acta.findFirst({ where: { cursoId }, orderBy: { version: 'desc' } });
  }

  /** RF-ACTA-01 — Crea una nueva versión del acta (reapertura → versión siguiente, RN-06). */
  async generar(cursoId: string) {
    const ultima = await this.actaVigente(cursoId);
    return this.prisma.acta.create({ data: { cursoId, version: (ultima?.version ?? 0) + 1 } });
  }

  private async finalesPorCadete(user: JwtPayload, cursoId: string): Promise<Map<string, [NotaParcial, NotaParcial, NotaParcial]>> {
    const [c1, c2, c3] = await Promise.all([1, 2, 3].map((n) => this.calif.calculoParcial(user, cursoId, n)));
    const map = new Map<string, [NotaParcial, NotaParcial, NotaParcial]>();
    const buscar = (calc: { cadetes: { matricula: string; califFinal: number }[] }, mat: string) =>
      calc.cadetes.find((c) => c.matricula === mat)?.califFinal ?? 0;
    for (const cad of c1.cadetes) {
      map.set(cad.matricula, [buscar(c1, cad.matricula), buscar(c2, cad.matricula), buscar(c3, cad.matricula)]);
    }
    return map;
  }

  private async recuperacionesPorCadete(cursoId: string) {
    const p3 = await this.parcial3(cursoId);
    const rows = await this.prisma.examen.findMany({ where: { parcialId: p3.id, tipo: { in: TIPOS_RECUPERACION } } });
    const map = new Map<string, Partial<Record<TipoExamen, InstanciaRecuperacion>>>();
    for (const r of rows) {
      const val: InstanciaRecuperacion = r.estatus === 'NP' ? 'NP' : Number(r.valor);
      map.set(r.cadeteMatricula, { ...map.get(r.cadeteMatricula), [r.tipo]: val });
    }
    return map;
  }

  private entrada(
    parciales: [NotaParcial, NotaParcial, NotaParcial],
    rec: Partial<Record<TipoExamen, InstanciaRecuperacion>> | undefined,
  ): EntradaSemestre {
    return {
      parciales,
      ordinario: rec?.Ordinario ?? undefined,
      extraordinario: rec?.Extraordinario ?? undefined,
      tds: rec?.TDS ?? undefined,
    };
  }

  private async filas(user: JwtPayload, cursoId: string, grupoId: string): Promise<FilaActa[]> {
    const [finales, recuperaciones, cadetes] = await Promise.all([
      this.finalesPorCadete(user, cursoId),
      this.recuperacionesPorCadete(cursoId),
      this.prisma.cadete.findMany({ where: { grupoActualId: grupoId }, orderBy: { nombreCompleto: 'asc' } }),
    ]);
    return cadetes.map((cad) => {
      const parciales = finales.get(cad.matricula) ?? ([0, 0, 0] as [NotaParcial, NotaParcial, NotaParcial]);
      const rec = recuperaciones.get(cad.matricula);
      const entrada = this.entrada(parciales, rec);
      return {
        matricula: cad.matricula,
        nombreCompleto: cad.nombreCompleto,
        parciales,
        ordinario: rec?.Ordinario ?? null,
        extraordinario: rec?.Extraordinario ?? null,
        tds: rec?.TDS ?? null,
        observacion: observacionSemestral(entrada),
        calificacionFinal: calificacionFinalSemestre(entrada),
      };
    });
  }

  async vista(user: JwtPayload, cursoId: string) {
    const curso = await this.cursoConAcceso(user, cursoId);
    const acta = await this.actaVigente(cursoId);
    if (!acta) throw new NotFoundException('El acta aún no se ha generado (valide los 3 parciales)');
    return {
      version: acta.version,
      generadaEn: acta.generadaEn,
      firmadaDocenteEn: acta.firmadaDocenteEn,
      firmadaCoordinacionEn: acta.firmadaCoordinacionEn,
      hashPdf: acta.hashPdf,
      cadetes: await this.filas(user, cursoId, curso.grupoId),
    };
  }

  /** RF-ACTA-03/04 — Captura una instancia de recuperación, gated por elegibilidad (RN-04). */
  async capturarRecuperacion(user: JwtPayload, cursoId: string, dto: RecuperacionDto) {
    const curso = await this.cursoConAcceso(user, cursoId);
    if (!(await this.actaVigente(cursoId))) throw new BadRequestException('El acta aún no se ha generado');

    const cadete = await this.prisma.cadete.findUnique({ where: { matricula: dto.cadeteMatricula } });
    if (!cadete || cadete.grupoActualId !== curso.grupoId) throw new BadRequestException('Cadete no pertenece al grupo del curso');
    if (cadete.estatus === 'BajaDefinitiva') throw new BadRequestException('Cadete en baja definitiva');

    const parciales = (await this.finalesPorCadete(user, cursoId)).get(dto.cadeteMatricula) ?? ([0, 0, 0] as [NotaParcial, NotaParcial, NotaParcial]);
    const rec = (await this.recuperacionesPorCadete(cursoId)).get(dto.cadeteMatricula);
    const baseObs = observacionSemestral({ parciales });
    const conExtraObs = observacionSemestral({ parciales, extraordinario: rec?.Extraordinario ?? undefined });

    const elegible =
      (dto.tipo === 'Ordinario' && baseObs === 'Presenta Ordinario') ||
      (dto.tipo === 'Extraordinario' && baseObs === 'Presenta Extraordinario') ||
      (dto.tipo === 'TDS' && conExtraObs === 'Habilita TDS');
    if (!elegible) throw new BadRequestException(`El cadete no es elegible para ${dto.tipo} (RN-04)`);

    const esNP = dto.np === true;
    if (!esNP && typeof dto.valor !== 'number') throw new BadRequestException('Indique un valor [0,10] o np:true');
    const data = { valor: esNP ? null : dto.valor!, estatus: esNP ? ('NP' as const) : ('PRESENTADO' as const), capturadoPor: user.sub };
    const p3 = await this.parcial3(cursoId);
    await this.prisma.examen.upsert({
      where: { cadeteMatricula_parcialId_tipo: { cadeteMatricula: dto.cadeteMatricula, parcialId: p3.id, tipo: dto.tipo } },
      create: { cadeteMatricula: dto.cadeteMatricula, parcialId: p3.id, tipo: dto.tipo, ...data },
      update: data,
    });
    return { ok: true };
  }

  /** RF-ACTA-06 — Doble firma: Docente firma como autor, Coordinación como validador. */
  async firmar(user: JwtPayload, cursoId: string) {
    await this.cursoConAcceso(user, cursoId);
    const acta = await this.actaVigente(cursoId);
    if (!acta) throw new NotFoundException('El acta aún no se ha generado');
    const data = user.rol === 'Docente' ? { firmadaDocenteEn: new Date() } : { firmadaCoordinacionEn: new Date() };
    return this.prisma.acta.update({ where: { id: acta.id }, data });
  }

  /** RF-ACTA-07 — Exportación: documento canónico + hash de integridad SHA-256 (PDF/A en capa de reportes). */
  async exportar(user: JwtPayload, cursoId: string) {
    const documento = await this.vista(user, cursoId);
    const acta = await this.actaVigente(cursoId);
    const hash = createHash('sha256').update(JSON.stringify(documento)).digest('hex');
    await this.prisma.acta.update({ where: { id: acta!.id }, data: { hashPdf: hash } });
    return { version: documento.version, hash, documento };
  }
}

@Controller('cursos/:cursoId/acta')
export class ActaController {
  constructor(private readonly acta: ActaService) {}

  @Get()
  vista(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string) {
    return this.acta.vista(user, cursoId);
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('recuperacion')
  @HttpCode(HttpStatus.OK)
  recuperacion(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Body() dto: RecuperacionDto) {
    return this.acta.capturarRecuperacion(user, cursoId, dto);
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('firmar')
  @HttpCode(HttpStatus.OK)
  firmar(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string) {
    if (user.rol === 'Operador') throw new ForbiddenException('El Operador no firma actas');
    return this.acta.firmar(user, cursoId);
  }

  @Get('export')
  exportar(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string) {
    return this.acta.exportar(user, cursoId);
  }
}

@Module({
  imports: [CalificacionModule],
  controllers: [ActaController],
  providers: [ActaService],
  exports: [ActaService],
})
export class ActaModule {}
