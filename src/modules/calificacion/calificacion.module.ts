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
  Patch,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EstadoParcial, Prisma, TipoCategoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel } from '../../common/scope';
import {
  CALIF_MAX,
  CALIF_MIN,
  PesosParcial,
  ValorExamen,
  calificacionCrudaParcial,
  calificacionFinalParcial,
  criteriosSumanMacro,
  esSDE,
  evaluacionContinua,
  pesoExEnRango,
  pesosSumanUno,
  promedioCategoria,
} from '../../domain';

const TIPOS: TipoCategoria[] = ['TI', 'TE', 'TA'];
const MAX_ACTIVIDADES_POR_TIPO = 30;
// Estados no editables: la reapertura formal de un parcial validado es I7 (RN-06).
const ESTADOS_BLOQUEADOS: EstadoParcial[] = ['CerradoDocente', 'Validado'];

const macroDe = (pesos: PesosParcial, tipo: TipoCategoria): number =>
  tipo === 'TI' ? pesos.ti : tipo === 'TE' ? pesos.te : pesos.ta;

class CriterioPesoDto {
  @IsIn(TIPOS) tipo!: TipoCategoria;
  @IsInt() @Min(1) @Max(5) orden!: number;
  @IsNumber() @Min(0) @Max(1) peso!: number;
}

class PesosDto {
  @IsNumber() @Min(0) @Max(1) ti!: number;
  @IsNumber() @Min(0) @Max(1) te!: number;
  @IsNumber() @Min(0) @Max(1) ta!: number;
  @IsNumber() @Min(0) @Max(1) ex!: number;
  @ValidateNested({ each: true })
  @Type(() => CriterioPesoDto)
  @ArrayMinSize(15)
  criterios!: CriterioPesoDto[];
}

class CrearActividadDto {
  @IsIn(TIPOS) tipo!: TipoCategoria;
  @IsString() @MinLength(1) nombre!: string;
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() criterioId?: string;
}

class CalificacionRegistroDto {
  @IsString() @MinLength(1) cadeteMatricula!: string;
  @IsNumber() @Min(CALIF_MIN) @Max(CALIF_MAX) valor!: number;
}

class CapturarCalificacionesDto {
  @ValidateNested({ each: true })
  @Type(() => CalificacionRegistroDto)
  @ArrayMinSize(1)
  registros!: CalificacionRegistroDto[];
}

class ExamenRegistroDto {
  @IsString() @MinLength(1) cadeteMatricula!: string;
  @IsOptional() @IsNumber() @Min(CALIF_MIN) @Max(CALIF_MAX) valor?: number;
  @IsOptional() @IsBoolean() np?: boolean;
}

class CapturarExamenDto {
  @ValidateNested({ each: true })
  @Type(() => ExamenRegistroDto)
  @ArrayMinSize(1)
  registros!: ExamenRegistroDto[];
}

class PuntoExtraRegistroDto {
  @IsString() @MinLength(1) cadeteMatricula!: string;
  @IsBoolean() aplica!: boolean;
  @IsOptional() @IsString() motivo?: string;
}

class PuntoExtraDto {
  @ValidateNested({ each: true })
  @Type(() => PuntoExtraRegistroDto)
  @ArrayMinSize(1)
  registros!: PuntoExtraRegistroDto[];
}

@Injectable()
export class CalificacionService {
  constructor(private readonly prisma: PrismaService) {}

  private async cursoConAcceso(user: JwtPayload, cursoId: string) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    return curso;
  }

  private async parcialEditable(user: JwtPayload, cursoId: string, numero: number) {
    const curso = await this.cursoConAcceso(user, cursoId);
    if (![1, 2, 3].includes(numero)) throw new BadRequestException('Parcial debe ser 1, 2 o 3');
    const parcial = await this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } });
    if (ESTADOS_BLOQUEADOS.includes(parcial.estado)) {
      throw new BadRequestException(`El parcial está ${parcial.estado} y es inmutable (requiere reapertura formal)`);
    }
    return { curso, parcial };
  }

  private async validaCadeteCapturable(matricula: string, grupoId: string) {
    const cadete = await this.prisma.cadete.findUnique({ where: { matricula } });
    if (!cadete) throw new BadRequestException(`Cadete ${matricula} no existe`);
    if (cadete.grupoActualId !== grupoId) throw new BadRequestException(`Cadete ${matricula} no pertenece al grupo del curso`);
    // RN-05: en baja definitiva no se registran nuevas calificaciones.
    if (cadete.estatus === 'BajaDefinitiva') throw new BadRequestException(`Cadete ${matricula} está en baja definitiva`);
    return cadete;
  }

  /** Faltas no justificadas (código F) por cadete dentro de la ventana del parcial (RN-01). */
  private async faltasEnParcial(cursoId: string, parcial: { fechaInicio: Date | null; fechaFin: Date | null }) {
    const filas = await this.prisma.asistencia.groupBy({
      by: ['cadeteMatricula'],
      where: { cursoId, codigo: 'F', fecha: { gte: parcial.fechaInicio!, lte: parcial.fechaFin! } },
      _count: { _all: true },
    });
    return new Map(filas.map((f) => [f.cadeteMatricula, f._count._all]));
  }

  /** RF-POND-01/02/03 — Edita los pesos macro y los 15 criterios del parcial. */
  async editarPesos(user: JwtPayload, cursoId: string, numero: number, dto: PesosDto) {
    const { parcial } = await this.parcialEditable(user, cursoId, numero);
    const pesos: PesosParcial = { ti: dto.ti, te: dto.te, ta: dto.ta, ex: dto.ex };

    if (!pesosSumanUno(pesos)) throw new BadRequestException('Los pesos TI+TE+TA+EX deben sumar 1.0 (RF-POND-01)');
    if (!pesoExEnRango(pesos.ex)) throw new BadRequestException('El peso del examen debe estar en [0.20, 0.70] (RN-02)');
    for (const tipo of TIPOS) {
      const delTipo = dto.criterios.filter((c) => c.tipo === tipo).map((c) => c.peso);
      if (!criteriosSumanMacro(delTipo, macroDe(pesos, tipo))) {
        throw new BadRequestException(`Los criterios ${tipo} deben sumar su peso macro ${macroDe(pesos, tipo)} (RF-POND-03)`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.parcial.update({
        where: { id: parcial.id },
        data: { pesoTI: pesos.ti, pesoTE: pesos.te, pesoTA: pesos.ta, pesoEX: pesos.ex },
      });
      for (const c of dto.criterios) {
        await tx.criterio.update({
          where: { parcialId_tipo_orden: { parcialId: parcial.id, tipo: c.tipo, orden: c.orden } },
          data: { peso: c.peso },
        });
      }
      return tx.parcial.findUniqueOrThrow({ where: { id: parcial.id }, include: { criterios: { orderBy: [{ tipo: 'asc' }, { orden: 'asc' }] } } });
    });
  }

  /** Matriz de captura: actividades × cadetes con los valores ya guardados (para prellenar la UI). */
  async matriz(user: JwtPayload, cursoId: string, numero: number) {
    const curso = await this.cursoConAcceso(user, cursoId);
    if (![1, 2, 3].includes(numero)) throw new BadRequestException('Parcial debe ser 1, 2 o 3');
    const parcial = await this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } });
    const [actividades, cadetes] = await Promise.all([
      this.prisma.actividad.findMany({ where: { parcialId: parcial.id }, orderBy: [{ tipo: 'asc' }, { orden: 'asc' }] }),
      this.prisma.cadete.findMany({ where: { grupoActualId: curso.grupoId }, orderBy: { nombreCompleto: 'asc' } }),
    ]);
    const [califs, examenes] = await Promise.all([
      this.prisma.calificacion.findMany({ where: { actividadId: { in: actividades.map((a) => a.id) } } }),
      this.prisma.examen.findMany({ where: { parcialId: parcial.id, tipo: 'Parcial' } }),
    ]);

    const calificaciones: Record<string, Record<string, number | null>> = {};
    for (const c of califs) {
      (calificaciones[c.cadeteMatricula] ??= {})[c.actividadId] = c.valor === null ? null : Number(c.valor);
    }
    const examenesMap: Record<string, { valor: number | null; estatus: string }> = {};
    for (const e of examenes) {
      examenesMap[e.cadeteMatricula] = { valor: e.valor === null ? null : Number(e.valor), estatus: e.estatus };
    }

    return {
      actividades: actividades.map((a) => ({ id: a.id, tipo: a.tipo, orden: a.orden, nombre: a.nombre })),
      cadetes: cadetes.map((c) => ({ matricula: c.matricula, nombreCompleto: c.nombreCompleto, estatus: c.estatus })),
      calificaciones,
      examenes: examenesMap,
    };
  }

  async listarActividades(user: JwtPayload, cursoId: string, numero: number) {
    await this.cursoConAcceso(user, cursoId);
    const parcial = await this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } });
    return this.prisma.actividad.findMany({ where: { parcialId: parcial.id }, orderBy: [{ tipo: 'asc' }, { orden: 'asc' }] });
  }

  /** RF-CAL-01 — Crea una actividad; bloquea la 31ª de una categoría. */
  async crearActividad(user: JwtPayload, cursoId: string, numero: number, dto: CrearActividadDto) {
    const { parcial } = await this.parcialEditable(user, cursoId, numero);
    const usadas = await this.prisma.actividad.count({ where: { parcialId: parcial.id, tipo: dto.tipo } });
    if (usadas >= MAX_ACTIVIDADES_POR_TIPO) {
      throw new BadRequestException(`Máximo ${MAX_ACTIVIDADES_POR_TIPO} actividades por categoría (RF-CAL-01)`);
    }
    return this.prisma.actividad.create({
      data: {
        parcialId: parcial.id,
        tipo: dto.tipo,
        orden: usadas + 1,
        nombre: dto.nombre,
        fecha: dto.fecha ? new Date(dto.fecha) : null,
        criterioId: dto.criterioId ?? null,
      },
    });
  }

  /** RF-CAL-03/04 — Captura masiva de calificaciones de una actividad. */
  async capturarCalificaciones(user: JwtPayload, cursoId: string, actividadId: string, dto: CapturarCalificacionesDto) {
    const curso = await this.cursoConAcceso(user, cursoId);
    const actividad = await this.prisma.actividad.findUnique({ where: { id: actividadId }, include: { parcial: true } });
    if (!actividad || actividad.parcial.cursoId !== cursoId) throw new NotFoundException('Actividad no existe en este curso');
    if (ESTADOS_BLOQUEADOS.includes(actividad.parcial.estado)) {
      throw new BadRequestException('El parcial es inmutable (requiere reapertura formal)');
    }

    for (const r of dto.registros) await this.validaCadeteCapturable(r.cadeteMatricula, curso.grupoId);

    await this.prisma.$transaction(
      dto.registros.map((r) =>
        this.prisma.calificacion.upsert({
          where: { cadeteMatricula_actividadId: { cadeteMatricula: r.cadeteMatricula, actividadId } },
          create: { cadeteMatricula: r.cadeteMatricula, actividadId, valor: r.valor, capturadaPor: user.sub },
          update: { valor: r.valor, capturadaPor: user.sub, capturadaEn: new Date() },
        }),
      ),
    );
    return { capturados: dto.registros.length };
  }

  /** RF-CAL-06/07 — Captura del examen parcial (valor o NP); bloquea a cadetes SDE (RN-01). */
  async capturarExamen(user: JwtPayload, cursoId: string, numero: number, dto: CapturarExamenDto) {
    const { curso, parcial } = await this.parcialEditable(user, cursoId, numero);
    const faltas = await this.faltasEnParcial(cursoId, parcial);

    for (const r of dto.registros) {
      await this.validaCadeteCapturable(r.cadeteMatricula, curso.grupoId);
      const esNP = r.np === true;
      if (!esNP && typeof r.valor !== 'number') {
        throw new BadRequestException(`Examen de ${r.cadeteMatricula}: indique un valor [0,10] o np:true (RF-CAL-06)`);
      }
      // RN-01: un cadete SDE no puede registrar examen (no suma al parcial).
      if (esSDE(faltas.get(r.cadeteMatricula) ?? 0)) {
        throw new BadRequestException(`Cadete ${r.cadeteMatricula} está SDE: no puede capturar examen (RN-01)`);
      }
    }

    await this.prisma.$transaction(
      dto.registros.map((r) => {
        const esNP = r.np === true;
        const data = { valor: esNP ? null : r.valor!, estatus: esNP ? ('NP' as const) : ('PRESENTADO' as const), capturadoPor: user.sub };
        return this.prisma.examen.upsert({
          where: { cadeteMatricula_parcialId_tipo: { cadeteMatricula: r.cadeteMatricula, parcialId: parcial.id, tipo: 'Parcial' } },
          create: { cadeteMatricula: r.cadeteMatricula, parcialId: parcial.id, tipo: 'Parcial', ...data },
          update: data,
        });
      }),
    );
    return { capturados: dto.registros.length };
  }

  /** RF-POND-05 — Marca/desmarca el punto extra por cadete. */
  async editarPuntoExtra(user: JwtPayload, cursoId: string, numero: number, dto: PuntoExtraDto) {
    const { curso, parcial } = await this.parcialEditable(user, cursoId, numero);
    for (const r of dto.registros) await this.validaCadeteCapturable(r.cadeteMatricula, curso.grupoId);

    await this.prisma.$transaction(
      dto.registros.map((r) =>
        this.prisma.puntoExtra.upsert({
          where: { cadeteMatricula_parcialId: { cadeteMatricula: r.cadeteMatricula, parcialId: parcial.id } },
          create: { cadeteMatricula: r.cadeteMatricula, parcialId: parcial.id, aplica: r.aplica, motivo: r.motivo ?? null },
          update: { aplica: r.aplica, motivo: r.motivo ?? null },
        }),
      ),
    );
    return { actualizados: dto.registros.length };
  }

  /**
   * Vista derivada del parcial (no se persiste). Por cada cadete del grupo aplica las
   * fórmulas de dominio: promedios por categoría, EC, ponderación del examen (SDE/NP),
   * piso de 5, redondeo y punto extra.
   */
  async calculoParcial(user: JwtPayload, cursoId: string, numero: number) {
    const curso = await this.cursoConAcceso(user, cursoId);
    if (![1, 2, 3].includes(numero)) throw new BadRequestException('Parcial debe ser 1, 2 o 3');
    const parcial = await this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } });
    const pesos: PesosParcial = {
      ti: Number(parcial.pesoTI),
      te: Number(parcial.pesoTE),
      ta: Number(parcial.pesoTA),
      ex: Number(parcial.pesoEX),
    };

    const [cadetes, actividades, examenes, puntos, faltas] = await Promise.all([
      this.prisma.cadete.findMany({ where: { grupoActualId: curso.grupoId }, orderBy: { nombreCompleto: 'asc' } }),
      this.prisma.actividad.findMany({ where: { parcialId: parcial.id } }),
      this.prisma.examen.findMany({ where: { parcialId: parcial.id, tipo: 'Parcial' } }),
      this.prisma.puntoExtra.findMany({ where: { parcialId: parcial.id } }),
      this.faltasEnParcial(cursoId, parcial),
    ]);

    const tipoDeActividad = new Map(actividades.map((a) => [a.id, a.tipo]));
    const califs = await this.prisma.calificacion.findMany({ where: { actividadId: { in: actividades.map((a) => a.id) } } });

    // matricula → tipo → valores
    const notas = new Map<string, Record<TipoCategoria, number[]>>();
    for (const c of califs) {
      const tipo = tipoDeActividad.get(c.actividadId)!;
      const porTipo = notas.get(c.cadeteMatricula) ?? { TI: [], TE: [], TA: [] };
      if (c.valor !== null) porTipo[tipo].push(Number(c.valor));
      notas.set(c.cadeteMatricula, porTipo);
    }
    const examenPorCadete = new Map(examenes.map((e) => [e.cadeteMatricula, e]));
    const puntoPorCadete = new Map(puntos.map((p) => [p.cadeteMatricula, p.aplica]));

    return {
      parcial: numero,
      pesos,
      cadetes: cadetes.map((cadete) => {
        const porTipo = notas.get(cadete.matricula) ?? { TI: [], TE: [], TA: [] };
        const promTI = promedioCategoria(porTipo.TI);
        const promTE = promedioCategoria(porTipo.TE);
        const promTA = promedioCategoria(porTipo.TA);
        const sde = esSDE(faltas.get(cadete.matricula) ?? 0);
        const ex = examenPorCadete.get(cadete.matricula);
        const examen: ValorExamen = !ex || ex.estatus === 'NP' ? 'NP' : Number(ex.valor);
        const cruda = calificacionCrudaParcial({ promTI, promTE, promTA, pesos, examen, sde });
        const puntoExtra = puntoPorCadete.get(cadete.matricula) ?? false;
        return {
          matricula: cadete.matricula,
          nombreCompleto: cadete.nombreCompleto,
          estatus: cadete.estatus,
          promTI,
          promTE,
          promTA,
          evaluacionContinua: evaluacionContinua(promTI, promTE, promTA, pesos),
          examen: !ex ? null : examen,
          sde,
          califCruda: cruda,
          puntoExtra,
          califFinal: calificacionFinalParcial(cruda, puntoExtra),
        };
      }),
    };
  }
}

@Controller('cursos/:cursoId')
export class CalificacionController {
  constructor(private readonly svc: CalificacionService) {}

  @Roles('Docente', 'Coordinador', 'Operador')
  @Patch('parciales/:numero/pesos')
  @HttpCode(HttpStatus.OK)
  editarPesos(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Body() dto: PesosDto) {
    return this.svc.editarPesos(user, cursoId, Number(numero), dto);
  }

  @Get('parciales/:numero/actividades')
  listarActividades(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string) {
    return this.svc.listarActividades(user, cursoId, Number(numero));
  }

  @Get('parciales/:numero/calificaciones')
  matriz(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string) {
    return this.svc.matriz(user, cursoId, Number(numero));
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('parciales/:numero/actividades')
  @HttpCode(HttpStatus.CREATED)
  crearActividad(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Body() dto: CrearActividadDto) {
    return this.svc.crearActividad(user, cursoId, Number(numero), dto);
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('actividades/:actividadId/calificaciones')
  @HttpCode(HttpStatus.OK)
  capturarCalificaciones(
    @CurrentUser() user: JwtPayload,
    @Param('cursoId') cursoId: string,
    @Param('actividadId') actividadId: string,
    @Body() dto: CapturarCalificacionesDto,
  ) {
    return this.svc.capturarCalificaciones(user, cursoId, actividadId, dto);
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('parciales/:numero/examen')
  @HttpCode(HttpStatus.OK)
  capturarExamen(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Body() dto: CapturarExamenDto) {
    return this.svc.capturarExamen(user, cursoId, Number(numero), dto);
  }

  @Roles('Docente', 'Coordinador', 'Operador')
  @Patch('parciales/:numero/punto-extra')
  @HttpCode(HttpStatus.OK)
  editarPuntoExtra(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Body() dto: PuntoExtraDto) {
    return this.svc.editarPuntoExtra(user, cursoId, Number(numero), dto);
  }

  @Get('parciales/:numero/calculo')
  calculo(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string) {
    return this.svc.calculoParcial(user, cursoId, Number(numero));
  }
}

@Module({
  controllers: [CalificacionController],
  providers: [CalificacionService],
  exports: [CalificacionService],
})
export class CalificacionModule {}
