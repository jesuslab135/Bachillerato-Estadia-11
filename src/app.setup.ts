import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/**
 * FB-B-5 — Allowlist de CORS saneada (trim + sin entradas vacías).
 * Sin allowlist configurada: en producción NO se refleja ningún origen (CORS deshabilitado);
 * fuera de producción se mantiene el modo permisivo de desarrollo.
 */
export function origenesCors(valor: string | undefined, produccion: boolean): string[] | boolean {
  const lista = (valor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lista.length > 0) return lista;
  return produccion ? false : true;
}

/**
 * Configuración compartida de la app (prefijo, seguridad, validación) para que
 * bootstrap (main.ts) y las pruebas e2e queden siempre alineados.
 */
export function configurarApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(helmet()); // RNF-SEC: cabeceras de seguridad (nosniff, frameguard, etc.).
  // RNF-SEC-04: CORS restringido por CORS_ORIGIN (lista separada por comas).
  app.enableCors({
    origin: origenesCors(process.env.CORS_ORIGIN, process.env.NODE_ENV === 'production'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
