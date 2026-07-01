import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/**
 * Configuración compartida de la app (prefijo, seguridad, validación) para que
 * bootstrap (main.ts) y las pruebas e2e queden siempre alineados.
 */
export function configurarApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(helmet()); // RNF-SEC: cabeceras de seguridad (nosniff, frameguard, etc.).
  // RNF-SEC-04: CORS restringido por CORS_ORIGIN (lista separada por comas); sin valor, refleja el origen.
  const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim());
  app.enableCors({ origin: origins && origins.length > 0 ? origins : true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
