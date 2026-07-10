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
 * Despliegue tras reverse proxy (nginx): el rate-limit por IP (RF-AUTH-05, RNF-SEC)
 * necesita la IP real del cliente vía X-Forwarded-For; sin esto todas las peticiones
 * comparten la IP del proxy y el límite de login se agota para el plantel entero.
 * TRUST_PROXY acepta el número de saltos de proxy ("1") o "true" (= 1 salto).
 * Ausente/"0"/"false": no se confía en ningún proxy (comportamiento de dev/test).
 */
export function saltosProxy(valor: string | undefined): number {
  const v = (valor ?? '').trim().toLowerCase();
  if (!v || v === 'false') return 0;
  if (v === 'true') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Configuración compartida de la app (prefijo, seguridad, validación) para que
 * bootstrap (main.ts) y las pruebas e2e queden siempre alineados.
 */
export function configurarApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  const saltos = saltosProxy(process.env.TRUST_PROXY);
  if (saltos > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', saltos);
  }
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
