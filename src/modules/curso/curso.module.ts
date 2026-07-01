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
  Patch,
  Post,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Prisma, TipoCategoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, filtroPlantel } from '../../common/scope';

// Defaults estructurales al instanciar un curso (RF-ASIG-03). Suman 1.0; EX en [0.20,0.70].
const PESOS_DEFECTO = { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4 };
const CRITERIOS_POR_TIPO = 5;
const TIPOS: TipoCategoria[] = ['TI', 'TE', 'TA'];
const NUMEROS_PARCIAL = [1, 2, 3];
const UN_DIA_MS = 86_400_000;

/**
 * Divide el rango del periodo en 3 ventanas de parcial contiguas y disjuntas
 * (default editable). Determinan a qué parcial pertenece una falta para el SDE.
 */
function ventanasParciales(inicio: Date, fin: Date): { inicio: Date; fin: Date }[] {
  const t0 = inicio.getTime();
  const paso = Math.floor((fin.getTime() - t0) / 3);
  const b1 = t0 + paso;
  const b2 = t0 + 2 * paso;
  return [
    { inicio: new Date(t0), fin: new Date(b1) },
    { inicio: new Date(b1 + UN_DIA_MS), fin: new Date(b2) },
    { inicio: new Date(b2 + UN_DIA_MS), fin: new Date(fin.getTime()) },
  ];
}

class CreateCursoDto {
  @IsString() @MinLength(1) materiaId!: string;
  @IsString() @MinLength(1) grupoId!: string;
  @IsString() @MinLength(1) docenteId!: string;
  @IsString() @MinLength(1) periodoId!: string;
}

class ReasignarDocenteDto {
  @IsString() @MinLength(1) docenteId!: string;
  @IsString() @MinLength(1) motivo!: string;
}

@Injectable()
export class CursoService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload) {
    return this.prisma.curso.findMany({
      where: { grupo: filtroPlantel(user) },
      include: { materia: true, grupo: true, periodo: true },
    });
  }

  private async cursoConAcceso(user: JwtPayload, cursoId: string) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);
    return curso;
  }

  async listarParciales(user: JwtPayload, cursoId: string) {
    await this.cursoConAcceso(user, cursoId);
    const parciales = await this.prisma.parcial.findMany({ where: { cursoId }, orderBy: { numero: 'asc' } });
    return parciales.map((p) => ({
      numero: p.numero,
      estado: p.estado,
      pesoTI: Number(p.pesoTI),
      pesoTE: Number(p.pesoTE),
      pesoTA: Number(p.pesoTA),
      pesoEX: Number(p.pesoEX),
      fechaInicio: p.fechaInicio,
      fechaFin: p.fechaFin,
      fechaAperturaCierre: p.fechaAperturaCierre,
    }));
  }

  async crear(user: JwtPayload, dto: CreateCursoDto) {
    const [grupo, periodo, materia, docente] = await Promise.all([
      this.prisma.grupo.findUnique({ where: { id: dto.grupoId } }),
      this.prisma.periodo.findUnique({ where: { id: dto.periodoId } }),
      this.prisma.materia.findUnique({ where: { id: dto.materiaId } }),
      this.prisma.usuario.findUnique({ where: { id: dto.docenteId } }),
    ]);
    if (!grupo) throw new NotFoundException('Grupo no existe');
    if (!periodo) throw new NotFoundException('Periodo no existe');
    if (!materia) throw new NotFoundException('Materia no existe');
    if (!docente) throw new NotFoundException('Docente no existe');
    if (grupo.plantelId !== periodo.plantelId) {
      throw new BadRequestException('El grupo y el periodo pertenecen a planteles distintos');
    }
    aseguraAccesoPlantel(user, grupo.plantelId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const curso = await tx.curso.create({
          data: {
            materiaId: dto.materiaId,
            grupoId: dto.grupoId,
            docenteId: dto.docenteId,
            periodoId: dto.periodoId,
          },
        });

        const ventanas = ventanasParciales(periodo.fechaInicio, periodo.fechaFin);
        for (const numero of NUMEROS_PARCIAL) {
          const ventana = ventanas[numero - 1];
          const parcial = await tx.parcial.create({
            data: {
              cursoId: curso.id,
              numero,
              pesoTI: PESOS_DEFECTO.ti,
              pesoTE: PESOS_DEFECTO.te,
              pesoTA: PESOS_DEFECTO.ta,
              pesoEX: PESOS_DEFECTO.ex,
              fechaInicio: ventana.inicio,
              fechaFin: ventana.fin,
            },
          });
          const macro: Record<TipoCategoria, number> = {
            TI: PESOS_DEFECTO.ti,
            TE: PESOS_DEFECTO.te,
            TA: PESOS_DEFECTO.ta,
          };
          const criterios = TIPOS.flatMap((tipo) =>
            Array.from({ length: CRITERIOS_POR_TIPO }, (_, i) => ({
              parcialId: parcial.id,
              tipo,
              orden: i + 1,
              nombre: `${tipo} ${i + 1}`,
              peso: macro[tipo] / CRITERIOS_POR_TIPO,
            })),
          );
          await tx.criterio.createMany({ data: criterios });
        }

        return tx.curso.findUniqueOrThrow({
          where: { id: curso.id },
          include: {
            parciales: {
              orderBy: { numero: 'asc' },
              include: { _count: { select: { criterios: true } } },
            },
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un curso con esa combinación Materia×Grupo×Docente×Periodo');
      }
      throw e;
    }
  }

  /** RF-ASIG-02 — Reasigna el docente con motivo y timestamp; preserva los datos del curso. */
  async reasignarDocente(user: JwtPayload, cursoId: string, dto: ReasignarDocenteDto) {
    const curso = await this.prisma.curso.findUnique({ where: { id: cursoId }, include: { grupo: true } });
    if (!curso) throw new NotFoundException('Curso no existe');
    aseguraAccesoPlantel(user, curso.grupo.plantelId);

    const docente = await this.prisma.usuario.findUnique({ where: { id: dto.docenteId } });
    if (!docente || docente.rol !== 'Docente') throw new BadRequestException('El docente indicado no existe');
    if (docente.plantelId !== curso.grupo.plantelId) throw new BadRequestException('El docente pertenece a otro plantel');

    await this.prisma.$transaction([
      this.prisma.curso.update({ where: { id: cursoId }, data: { docenteId: dto.docenteId } }),
      this.prisma.auditLog.create({
        data: {
          tipoEvento: 'REASIGNAR_DOCENTE',
          usuarioId: user.sub,
          entidad: 'Curso',
          entidadId: cursoId,
          valorAnteriorJson: { docenteId: curso.docenteId },
          valorNuevoJson: { docenteId: dto.docenteId, motivo: dto.motivo },
        },
      }),
    ]);
    return { docenteId: dto.docenteId };
  }
}

@Controller('cursos')
export class CursoController {
  constructor(private readonly cursos: CursoService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.cursos.findAll(user);
  }

  @Get(':cursoId/parciales')
  listarParciales(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string) {
    return this.cursos.listarParciales(user, cursoId);
  }

  @Roles('Coordinador', 'Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCursoDto) {
    return this.cursos.crear(user, dto);
  }

  @Roles('Coordinador', 'Operador')
  @Patch(':cursoId/docente')
  reasignarDocente(@CurrentUser() user: JwtPayload, @Param('cursoId') cursoId: string, @Body() dto: ReasignarDocenteDto) {
    return this.cursos.reasignarDocente(user, cursoId, dto);
  }
}

@Module({
  controllers: [CursoController],
  providers: [CursoService],
})
export class CursoModule {}
