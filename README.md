# SGA-Militar — backend

NestJS + Prisma (PostgreSQL 15). La **capa de dominio** (`src/domain/`, pura, sin DB/HTTP)
se añade en I2; este incremento (I1) cubre el modelo de datos, migraciones y seed.

> Nota: el framework NestJS (módulos HTTP) se introduce en el incremento de Auth (I3).
> Hasta entonces el backend es Prisma + Vitest sobre el modelo de datos.

## Requisitos
- Node 20+ y Docker Desktop (Postgres se levanta vía `docker-compose.yml`, puerto **5433**).

## Puesta en marcha
```powershell
copy .env.example .env      # ajusta credenciales si hace falta
npm install
npm run db:up               # levanta Postgres 15 en localhost:5433
npm run prisma:deploy       # aplica migraciones
npm run seed                # 2 planteles + 33 materias + roles base
npm test                    # Vitest: pruebas de restricciones del modelo (§3.6 del plan)
```

## Arrancar la API
```powershell
npm run start               # http://localhost:3000/api  (PORT configurable)
npm run start:dev           # con recarga en caliente (node --watch)
```
> El runtime usa `@swc-node/register` (no `tsx`) porque NestJS depende de
> `emitDecoratorMetadata` para su inyección de dependencias; tsx/esbuild no la emiten.

## API de autenticación (I3)
JWT (8 h). Todas las rutas exigen `Authorization: Bearer <token>` salvo el login.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | `{email,password}` → `{accessToken, debeCambiarContrasena}` (RF-AUTH-01) |
| POST | `/api/auth/change-password` | `{actual,nueva}` autenticado; obligatorio en primer ingreso (RF-AUTH-04) |
| POST | `/api/auth/desbloquear` | `{email}` — solo Coordinador/Operador (RF-AUTH-05) |

- Contraseñas: **bcrypt cost 12**. 5 intentos fallidos ⇒ bloqueo 15 min (parametrizable
  vía `AUTH_MAX_INTENTOS` / `AUTH_BLOQUEO_MINUTOS`). Logins quedan en `audit_log` con IP.
- Usuarios sembrados (`operador@sga.local`, `coord.bm@…`, `coord.bc@…`) arrancan con la
  contraseña temporal `SEED_PASSWORD` y `debeCambiarContrasena=true`.
- **Pendiente I4**: scoping por plantel (RF-AUTH-03) — el `@CurrentUser` ya expone
  `plantelId`; la restricción de datos se aplica cuando existan recursos con plantel.

## API de catálogos y asignación (I4)
Todo acotado por plantel (RF-AUTH-03): Docente/Coordinador solo ven su plantel; Operador global.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET/POST | `/api/planteles` | POST=Operador | RF-CAT-01 |
| GET/POST | `/api/grupos` | POST=Coord/Op | scoped |
| GET/POST | `/api/periodos` | POST=Coord/Op | |
| POST | `/api/periodos/:id/activar` | Coord/Op | desactiva el anterior (RF-CAT-04) |
| GET/POST | `/api/cursos` | POST=Coord/Op | crea 3 parciales + 15 criterios/parcial (RF-ASIG-03); combo único (RF-ASIG-01) |

> Defaults al instanciar un curso: pesos TI/TE/TA/EX = 0.2/0.2/0.2/0.4; 15 criterios por
> parcial (5 por tipo) con peso macro/5. Editables en el incremento de ponderación (I6).
> **Pendiente**: import CSV/XLSX (RF-CAT-07), panel docente (RF-ASIG-04), reasignación
> de docente con motivo (RF-ASIG-02).

## API de asistencia (I5)
| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/cursos/:id/asistencia` | Docente/Coord/Op | captura masiva `{fecha, registros:[{cadeteMatricula,codigo}]}` (upsert por día, RF-ASIS-01) |
| GET | `/api/cursos/:id/asistencia?fecha=` | autenticado | asistencias de una fecha |
| GET | `/api/cursos/:id/parciales/:n/resumen` | autenticado | contadores + SDE por cadete (RF-ASIS-03/04) |

> SDE (RN-01) se recalcula en cada lectura sobre la ventana de fechas del parcial;
> cambiar `F`→`J` restituye el derecho automáticamente (RF-ASIS-08). Se valida: código
> A/F/R/J, que el cadete pertenezca al grupo del curso, y que no esté en baja definitiva
> (RN-05). Todo acotado por plantel (RF-AUTH-03).
> **Pendiente**: captura offline/PWA (RF-ASIS-06) y gestión de Cadetes (CRUD) — por ahora
> los cadetes se crean directamente; su módulo llega con import (RF-CAT-07).

## API de catálogo — Materia
La fuente de verdad del catálogo es la **DB**; el seed solo la inicializa.
Lectura: cualquier autenticado. Mutación: solo Coordinador/Operador (RF-CAT-06).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/materias` | Lista; `?semestre=1..6`, `?incluirInactivas=true` |
| GET | `/api/materias/:clave` | Una materia por clave (404 si no existe) |
| POST | `/api/materias` | Crea (201; 409 si clave duplicada; 400 si inválida) |
| PATCH | `/api/materias/:clave` | Actualiza nombre/semestre/activo |
| DELETE | `/api/materias/:clave` | Borrado lógico (`activo=false`, RF-CAT-06) |

## Estructura
```
prisma/
  schema.prisma          modelo de datos (entidades, enums, uniques)
  migrations/            baseline + CHECKs/triggers/índice parcial en SQL crudo
  catalogo-materias.ts   datos bootstrap del seed (no es la fuente de verdad runtime)
  seed.ts                carga inicial
src/
  prisma/                PrismaModule + PrismaService (DI global)
  auth/                  login JWT, bcrypt, guardias globales (Jwt/Roles/MustChange)
  modules/materia/       controller + service + DTOs (catálogo sobre DB)
  domain/                reglas y cálculos puros — sin deps de DB/HTTP
  app.module.ts, main.ts
tests/db/                pruebas de integridad del modelo contra Postgres real
tests/e2e/               pruebas e2e de la API (supertest + Nest)
```


## Pendientes conocidos
- **Catálogo de materias** (`prisma/catalogo-materias.ts`): 33 materias FABRICADAS
  (plan general militarizado, 6 semestres). Sustituibles por el plan oficial cuando
  esté disponible; el seed y su prueba leen de ese único módulo.
- Claves de plantel `BM` / `BC` derivadas (no especificadas en `docs/`).
