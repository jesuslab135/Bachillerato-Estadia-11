import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MateriaModule } from './modules/materia/materia.module';
import { PlantelModule } from './modules/plantel/plantel.module';
import { GrupoModule } from './modules/grupo/grupo.module';
import { PeriodoModule } from './modules/periodo/periodo.module';
import { CursoModule } from './modules/curso/curso.module';
import { AsistenciaModule } from './modules/asistencia/asistencia.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    MateriaModule,
    PlantelModule,
    GrupoModule,
    PeriodoModule,
    CursoModule,
    AsistenciaModule,
  ],
})
export class AppModule {}
