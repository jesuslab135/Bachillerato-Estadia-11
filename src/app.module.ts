import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MateriaModule } from './modules/materia/materia.module';
import { PlantelModule } from './modules/plantel/plantel.module';
import { GrupoModule } from './modules/grupo/grupo.module';
import { PeriodoModule } from './modules/periodo/periodo.module';
import { CursoModule } from './modules/curso/curso.module';
import { AsistenciaModule } from './modules/asistencia/asistencia.module';
import { CalificacionModule } from './modules/calificacion/calificacion.module';
import { ActaModule } from './modules/acta/acta.module';
import { CadeteModule } from './modules/cadete/cadete.module';
import { DocenteModule } from './modules/docente/docente.module';
import { UsuarioModule } from './modules/usuario/usuario.module';
import { WorkflowModule } from './modules/workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // RNF-SEC: rate-limiting global por IP (parametrizable). El bloqueo por intentos de
    // login sigue siendo por usuario (RF-AUTH-05); esto añade protección a nivel de IP.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get('THROTTLE_TTL') ?? 60000),
          limit: Number(config.get('THROTTLE_LIMIT') ?? 1000),
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    MateriaModule,
    PlantelModule,
    GrupoModule,
    PeriodoModule,
    CursoModule,
    AsistenciaModule,
    CalificacionModule,
    ActaModule,
    CadeteModule,
    DocenteModule,
    UsuarioModule,
    WorkflowModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
