import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RolUsuario } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/app.setup';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configurarApp(app);
  await app.init();
  return app;
}

/** Acuña un JWT válido (firmado con el secreto de la app) para pruebas de autorización. */
export function tokenFor(
  app: INestApplication,
  opts: { rol?: RolUsuario; plantelId?: string | null; debeCambiar?: boolean; sub?: string } = {},
): string {
  const jwt = app.get(JwtService);
  return jwt.sign({
    sub: opts.sub ?? '00000000-0000-0000-0000-000000000000',
    email: 'test@sga.local',
    rol: opts.rol ?? 'Coordinador',
    plantelId: opts.plantelId ?? null,
    debeCambiar: opts.debeCambiar ?? false,
  });
}
