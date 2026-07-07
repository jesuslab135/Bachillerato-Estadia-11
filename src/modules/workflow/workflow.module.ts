import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { EstadoParcial, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, aseguraEscrituraDocente } from '../../common/scope';
import { ventanaDeParcial } from '../../common/parcial';
import { celdaCsv } from '../../common/csv';
import { esSDE, pesoExEnRango, pesosSumanUno } from '../../domain';
import { ActaModule, ActaService } from '../acta/acta.module';

// RN-06 — motivo mínimo para reabrir un parcial validado.
const MOTIVO_MIN = 30;

type Accion = 'cerrar' | 'validar' | 'devolver' | 'reabrir';

class DevolverDto {
  @IsString() @MinLength(1) comentario!: string;
}

class ReabrirDto {
  @IsString() @MinLength(MOTIVO_MIN) motivo!: string;
}

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acta: ActaService,
  ) {}

  private async cargarParcial(user: JwtPayload, cursoId: string, numero: number) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    if (![1, 2, 3].includes(numero)) throw new BadRequestException('Parcial debe ser 1, 2 o 3');
    const parcial = await this.prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } });
    return { curso, parcial };
  }

  /**
   * Transición atómica: cambia estado + WorkflowEvent + AuditLog (append-only).
   * FB-B-3 — compare-and-swap: el UPDATE exige el estado esperado; si otro proceso
   * ya transicionó el parcial (TOCTOU), se responde 409 y no se escribe nada.
   */
  private async transicionar(
    tx: Prisma.TransactionClient,
    parcial: { id: string; estado: EstadoParcial },
    nuevo: EstadoParcial,
    accion: Accion,
    user: JwtPayload,
    ip: string | null,
    motivo?: string,
  ) {
    const cas = await tx.parcial.updateMany({
      where: { id: parcial.id, estado: parcial.estado },
      data: { estado: nuevo },
    });
    if (cas.count === 0) {
      throw new ConflictException(`El parcial ya no está en estado ${parcial.estado}: otra operación lo transicionó (reintente)`);
    }
    await tx.workflowEvent.create({ data: { parcialId: parcial.id, accion, usuarioId: user.sub, motivo: motivo ?? null } });
    await tx.auditLog.create({
      data: {
        tipoEvento: `PARCIAL_${accion.toUpperCase()}`,
        usuarioId: user.sub,
        ip,
        entidad: 'Parcial',
        entidadId: parcial.id,
        valorAnteriorJson: { estado: parcial.estado },
        valorNuevoJson: { estado: nuevo, motivo: motivo ?? null },
      },
    });
  }

  /** RF-WF-02 — Condiciones de cierre del parcial. */
  async cerrar(user: JwtPayload, cursoId: string, numero: number, ip: string | null) {
    const { curso, parcial } = await this.cargarParcial(user, cursoId, numero);
    aseguraEscrituraDocente(user, curso.docenteId); // FB-B-6: solo el titular cierra su curso
    if (!['Borrador', 'Reabierto'].includes(parcial.estado)) {
      throw new ConflictException(`No se puede cerrar un parcial en estado ${parcial.estado}`);
    }
    // RF-WF-02: el cierre exige fecha posterior al inicio del periodo de cierre (si está definido).
    if (parcial.fechaAperturaCierre && new Date() < parcial.fechaAperturaCierre) {
      throw new BadRequestException('Aún no inicia el periodo de cierre del parcial (RF-WF-02)');
    }

    const pesos = { ti: Number(parcial.pesoTI), te: Number(parcial.pesoTE), ta: Number(parcial.pesoTA), ex: Number(parcial.pesoEX) };
    if (!pesosSumanUno(pesos)) throw new BadRequestException('Los pesos deben sumar 1.0 para cerrar (RF-WF-02)');
    if (!pesoExEnRango(pesos.ex)) throw new BadRequestException('El peso del examen debe estar en [0.20,0.70] para cerrar (RN-02)');

    const [cadetes, examenes, faltas] = await Promise.all([
      this.prisma.cadete.findMany({ where: { grupoActualId: curso.grupoId, estatus: 'Activo' } }),
      this.prisma.examen.findMany({ where: { parcialId: parcial.id, tipo: 'Parcial' }, select: { cadeteMatricula: true } }),
      this.faltasEnParcial(cursoId, parcial),
    ]);
    const conExamen = new Set(examenes.map((e) => e.cadeteMatricula));
    const faltantes = cadetes
      .filter((c) => !esSDE(faltas.get(c.matricula) ?? 0) && !conExamen.has(c.matricula))
      .map((c) => c.matricula);
    if (faltantes.length > 0) {
      throw new BadRequestException(`Cadetes activos sin examen ni SDE: ${faltantes.join(', ')} (RF-WF-02)`);
    }

    await this.prisma.$transaction((tx) => this.transicionar(tx, parcial, 'CerradoDocente', 'cerrar', user, ip));
    return { estado: 'CerradoDocente' };
  }

  async validar(user: JwtPayload, cursoId: string, numero: number, ip: string | null) {
    const { parcial } = await this.cargarParcial(user, cursoId, numero);
    if (parcial.estado !== 'CerradoDocente') throw new ConflictException('Solo se valida un parcial en CerradoDocente');

    // RF-ACTA-01 / FB-B-4 — con CUALQUIER orden de validación: si al validar este parcial
    // los 3 quedan Validado, el acta se genera dentro de la MISMA transacción que la
    // transición (el CAS de `transicionar` garantiza una sola generación por ciclo).
    await this.prisma.$transaction(async (tx) => {
      await this.transicionar(tx, parcial, 'Validado', 'validar', user, ip);
      const estados = await tx.parcial.findMany({ where: { cursoId }, select: { estado: true } });
      if (estados.length === 3 && estados.every((p) => p.estado === 'Validado')) {
        await this.acta.generar(user, cursoId, tx);
      }
    });
    return { estado: 'Validado' };
  }

  async devolver(user: JwtPayload, cursoId: string, numero: number, comentario: string, ip: string | null) {
    const { parcial } = await this.cargarParcial(user, cursoId, numero);
    if (parcial.estado !== 'CerradoDocente') throw new ConflictException('Solo se devuelve un parcial en CerradoDocente');
    await this.prisma.$transaction((tx) => this.transicionar(tx, parcial, 'Borrador', 'devolver', user, ip, comentario));
    return { estado: 'Borrador' };
  }

  /** RN-06 — Reapertura de un parcial validado (motivo obligatorio). La nueva versión de acta llega en I8. */
  async reabrir(user: JwtPayload, cursoId: string, numero: number, motivo: string, ip: string | null) {
    const { parcial } = await this.cargarParcial(user, cursoId, numero);
    if (parcial.estado !== 'Validado') throw new ConflictException('Solo se reabre un parcial Validado');
    await this.prisma.$transaction((tx) => this.transicionar(tx, parcial, 'Reabierto', 'reabrir', user, ip, motivo));
    return { estado: 'Reabierto' };
  }

  async eventos(user: JwtPayload, cursoId: string, numero: number) {
    const { parcial } = await this.cargarParcial(user, cursoId, numero);
    return this.prisma.workflowEvent.findMany({ where: { parcialId: parcial.id }, orderBy: { timestamp: 'asc' } });
  }

  private async faltasEnParcial(cursoId: string, parcial: { numero: number; fechaInicio: Date | null; fechaFin: Date | null }) {
    const ventana = ventanaDeParcial(parcial); // FB-B-7: 409 si la ventana es nula
    const filas = await this.prisma.asistencia.groupBy({
      by: ['cadeteMatricula'],
      where: { cursoId, codigo: 'F', fecha: { gte: ventana.inicio, lte: ventana.fin } },
      _count: { _all: true },
    });
    return new Map(filas.map((f) => [f.cadeteMatricula, f._count._all]));
  }
}

@Controller('cursos/:cursoId')
export class WorkflowController {
  constructor(private readonly wf: WorkflowService) {}

  @Roles('Docente', 'Coordinador', 'Operador')
  @Post('parciales/:numero/cerrar')
  @HttpCode(HttpStatus.OK)
  cerrar(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Req() req: { ip?: string }) {
    return this.wf.cerrar(user, cursoId, Number(numero), req.ip ?? null);
  }

  @Roles('Coordinador', 'Operador')
  @Post('parciales/:numero/validar')
  @HttpCode(HttpStatus.OK)
  validar(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string, @Req() req: { ip?: string }) {
    return this.wf.validar(user, cursoId, Number(numero), req.ip ?? null);
  }

  @Roles('Coordinador', 'Operador')
  @Post('parciales/:numero/devolver')
  @HttpCode(HttpStatus.OK)
  devolver(
    @CurrentUser() user: JwtPayload,
    @Param('cursoId') cursoId: string,
    @Param('numero') numero: string,
    @Body() dto: DevolverDto,
    @Req() req: { ip?: string },
  ) {
    return this.wf.devolver(user, cursoId, Number(numero), dto.comentario, req.ip ?? null);
  }

  @Roles('Coordinador', 'Operador')
  @Post('parciales/:numero/reabrir')
  @HttpCode(HttpStatus.OK)
  reabrir(
    @CurrentUser() user: JwtPayload,
    @Param('cursoId') cursoId: string,
    @Param('numero') numero: string,
    @Body() dto: ReabrirDto,
    @Req() req: { ip?: string },
  ) {
    return this.wf.reabrir(user, cursoId, Number(numero), dto.motivo, req.ip ?? null);
  }

  @Get('parciales/:numero/eventos')
  eventos(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Param('numero') numero: string) {
    return this.wf.eventos(user, cursoId, Number(numero));
  }
}

class BitacoraQueryDto {
  @IsOptional() @IsString() entidad?: string;
  @IsOptional() @IsString() entidadId?: string;
  @IsOptional() @IsString() usuarioId?: string;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
}

const BITACORA_LIMITE = 500;

const CAMPOS_CSV = ['timestamp', 'tipoEvento', 'entidad', 'entidadId', 'usuarioId', 'ip', 'valorAnteriorJson', 'valorNuevoJson'] as const;

@Controller('bitacora')
export class BitacoraController {
  constructor(private readonly prisma: PrismaService) {}

  private construirWhere(q: BitacoraQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.entidad) where.entidad = q.entidad;
    if (q.entidadId) where.entidadId = q.entidadId;
    if (q.usuarioId) where.usuarioId = q.usuarioId;
    if (q.desde || q.hasta) {
      where.timestamp = {};
      if (q.desde) where.timestamp.gte = new Date(q.desde);
      if (q.hasta) where.timestamp.lte = new Date(q.hasta);
    }
    return where;
  }

  /**
   * FB-B-6 — Scoping por plantel: el Coordinador solo ve eventos cuyo autor pertenece a su
   * plantel (join vía usuario, el vínculo más simple y correcto disponible en AuditLog);
   * el Operador es global.
   */
  private async filtroPorPlantel(user: JwtPayload): Promise<Prisma.AuditLogWhereInput> {
    if (user.rol === 'Operador') return {};
    const usuarios = await this.prisma.usuario.findMany({
      where: { plantelId: user.plantelId ?? '__sin_plantel__' },
      select: { id: true },
    });
    return { usuarioId: { in: usuarios.map((u) => u.id) } };
  }

  private async filas(user: JwtPayload, q: BitacoraQueryDto) {
    return this.prisma.auditLog.findMany({
      where: { AND: [this.construirWhere(q), await this.filtroPorPlantel(user)] },
      orderBy: { timestamp: 'desc' },
      take: BITACORA_LIMITE,
    });
  }

  /** RF-WF-05 — Consulta filtrada de la bitácora. */
  @Roles('Coordinador', 'Operador')
  @Get()
  consultar(@CurrentUser() user: JwtPayload, @Query() q: BitacoraQueryDto) {
    return this.filas(user, q);
  }

  /** RF-WF-05 — Exportación CSV de la bitácora filtrada. */
  @Roles('Coordinador', 'Operador')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="bitacora.csv"')
  async exportar(@CurrentUser() user: JwtPayload, @Query() q: BitacoraQueryDto) {
    const filas = await this.filas(user, q);
    const lineas = [CAMPOS_CSV.join(',')];
    for (const f of filas) lineas.push(CAMPOS_CSV.map((c) => celdaCsv((f as Record<string, unknown>)[c])).join(','));
    return lineas.join('\n');
  }
}

@Module({
  imports: [ActaModule],
  controllers: [WorkflowController, BitacoraController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
