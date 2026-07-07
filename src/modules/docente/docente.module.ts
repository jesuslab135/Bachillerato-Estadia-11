import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { fechaLocalISO } from '../../domain';

const DIAS_CIERRE_PROXIMO = 7;
const UN_DIA_MS = 86_400_000;
const ESTADOS_ABIERTOS = ['Borrador', 'Reabierto'];

@Injectable()
export class DocenteService {
  constructor(private readonly prisma: PrismaService) {}

  /** RF-ASIG-04 — Panel del docente: asistencia de hoy, parciales abiertos y cierres próximos. */
  async panel(user: JwtPayload) {
    const cursos = await this.prisma.curso.findMany({
      where: { docenteId: user.sub },
      include: { materia: true, grupo: true, parciales: true },
    });

    // FB-B-10 — "hoy" en la zona del plantel (con UTC, de 18:00 a 00:00 locales salía el día siguiente).
    const hoy = new Date(fechaLocalISO());
    const limite = new Date(hoy.getTime() + DIAS_CIERRE_PROXIMO * UN_DIA_MS);

    const filas = await Promise.all(
      cursos.map(async (c) => {
        const registros = await this.prisma.asistencia.count({ where: { cursoId: c.id, fecha: hoy } });
        return {
          cursoId: c.id,
          materia: { clave: c.materia.clave, nombre: c.materia.nombre },
          grupo: { nombre: c.grupo.nombre },
          parcialesAbiertos: c.parciales
            .filter((p) => ESTADOS_ABIERTOS.includes(p.estado))
            .map((p) => p.numero)
            .sort((a, b) => a - b),
          asistenciaHoy: { fecha: hoy, capturada: registros > 0, registros },
          cierresProximos: c.parciales
            .filter((p) => p.fechaFin && p.fechaFin >= hoy && p.fechaFin <= limite)
            .map((p) => ({ parcial: p.numero, fechaFin: p.fechaFin }))
            .sort((a, b) => a.parcial - b.parcial),
        };
      }),
    );
    return { cursos: filas };
  }
}

@Controller('docente')
export class DocenteController {
  constructor(private readonly docente: DocenteService) {}

  @Get('panel')
  panel(@CurrentUser() user: JwtPayload) {
    return this.docente.panel(user);
  }
}

@Module({
  controllers: [DocenteController],
  providers: [DocenteService],
})
export class DocenteModule {}
