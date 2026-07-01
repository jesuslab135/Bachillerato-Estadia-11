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
npm run seed:test           # opcional: limpia la DB y siembra datos de prueba end-to-end
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
| GET | `/api/cursos/:id/parciales` | autenticado | lista los 3 parciales con estado y pesos (para la UI de ponderación/workflow) |
| GET | `/api/usuarios?rol=` | Coord/Op | lista usuarios del plantel (sin hash) para selectores (p. ej. docentes al crear curso) |

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

## API de calificaciones y ponderación (I6)
Captura de calificaciones/examen, edición de la ponderación y cálculo derivado del parcial.
Todo acotado por plantel; mutación por Docente/Coordinador/Operador. Un parcial en estado
`CerradoDocente`/`Validado` es inmutable (reapertura formal → I7).

| Método | Ruta | Notas |
|---|---|---|
| PATCH | `/api/cursos/:id/parciales/:n/pesos` | `{ti,te,ta,ex, criterios:[{tipo,orden,peso}]×15}`. Valida suma=1.0 (RF-POND-01), %EX∈[0.20,0.70] (RN-02), criterios=peso macro (RF-POND-03) |
| GET/POST | `/api/cursos/:id/parciales/:n/actividades` | crea actividad (orden autoincremental); bloquea la 31ª por categoría (RF-CAL-01) |
| GET | `/api/cursos/:id/parciales/:n/calificaciones` | matriz actividades×cadetes con valores guardados (examen incl.) para prellenar la UI |
| POST | `/api/cursos/:id/actividades/:aid/calificaciones` | bulk `{registros:[{cadeteMatricula,valor}]}`, valor∈[0,10] (RF-CAL-03); ignora 0 en el promedio (RF-CAL-04) |
| POST | `/api/cursos/:id/parciales/:n/examen` | bulk `{registros:[{cadeteMatricula, valor \| np:true}]}` (RF-CAL-06); rechaza si el cadete está SDE (RF-CAL-07/RN-01) |
| PATCH | `/api/cursos/:id/parciales/:n/punto-extra` | bulk `{registros:[{cadeteMatricula,aplica,motivo?}]}` (RF-POND-05) |
| GET | `/api/cursos/:id/parciales/:n/calculo` | **vista derivada** (no se persiste): por cadete promTI/TE/TA, EC, examen ponderado (SDE/NP), cruda, y final con piso de 5 → round → punto extra (RN-03) |

> Las fórmulas viven en `src/domain/` (100% cobertura); este módulo solo las orquesta
> sobre datos reales. `promedio_categoría` es media plana de calificaciones con valor>0
> (modelo.md); los pesos de criterios son restricción estructural, no entran en la EC.
> **Pendiente**: cuadrícula con teclado/pegado/autosalvado (RF-CAL-05) → frontend.

## API de workflow y auditoría del parcial (I7)
Máquina de estados del parcial + bitácora. Transiciones acotadas por plantel; cada una
escribe `WorkflowEvent` + `AuditLog` (usuario, IP, estado anterior/nuevo) de forma atómica.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/cursos/:id/parciales/:n/cerrar` | Docente/Coord/Op | Borrador/Reabierto→CerradoDocente; exige pesos=1.0, %EX∈[0.20,0.70], todo activo con examen o SDE, y fecha ≥ `fechaAperturaCierre` si está definida (RF-WF-02) |
| POST | `/api/cursos/:id/parciales/:n/validar` | Coord/Op | CerradoDocente→Validado (RF-WF-01/03) |
| POST | `/api/cursos/:id/parciales/:n/devolver` | Coord/Op | `{comentario}` CerradoDocente→Borrador (RF-WF-03) |
| POST | `/api/cursos/:id/parciales/:n/reabrir` | Coord/Op | `{motivo≥30}` Validado→Reabierto (RN-06) |
| GET | `/api/cursos/:id/parciales/:n/eventos` | autenticado | eventos de workflow del parcial |
| GET | `/api/bitacora` | Coord/Op | filtros `entidad, entidadId, usuarioId, desde, hasta` (RF-WF-05) |
| GET | `/api/bitacora/export` | Coord/Op | mismos filtros → CSV (RFC 4180) descargable (RF-WF-05) |

> Un parcial `CerradoDocente`/`Validado` es inmutable (guard en captura/ponderación, RN-06);
> `devolver`/`reabrir` lo vuelven editable. `workflow_event` y `audit_log` son append-only
> (triggers en DB rechazan UPDATE/DELETE).
> **Pendiente**: nueva versión de acta al reabrir (RN-06) → I8.

## API de acta semestral (I8)
Acta derivada del curso: cascada RN-04, recuperaciones, doble firma y hash de integridad.
El acta se genera al validar el 3er parcial (con 1 y 2 ya validados); cada reapertura +
revalidación crea una nueva versión (RN-06).

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/api/cursos/:id/acta` | autenticado | vista vigente: por cadete `[f1,f2,f3]`, recuperaciones, observación, calif. final (RN-04); 404 si no generada |
| POST | `/api/cursos/:id/acta/recuperacion` | Docente/Coord/Op | `{cadeteMatricula, tipo, valor\|np}`; elegibilidad por observación (Ordinario/Extraordinario/TDS, RF-ACTA-03/04) |
| POST | `/api/cursos/:id/acta/firmar` | Docente / Coord | Docente→`firmadaDocenteEn`, Coordinación→`firmadaCoordinacionEn` (RF-ACTA-06); Operador no firma |
| GET | `/api/cursos/:id/acta/export` | autenticado | documento canónico + hash SHA-256 (persistido en `hashPdf`, RF-ACTA-07) |

> La calif. final por cadete reutiliza el `calculo` de los 3 parciales (I6) y la cascada
> pura `domain/semestre.ts` (RN-04, 100% cubierta). Las recuperaciones se guardan como
> `Examen` (tipo Ordinario/Extraordinario/TDS) sobre el parcial 3.
> **Pendiente**: render **PDF/A** binario (capa de reportes/frontend) — aquí se entrega el
> documento canónico + hash de integridad.

## API de cadetes, panel docente y reasignación (backend gaps)

**Cadetes** (`/api/cadetes`, scope por plantel; mutación Coord/Op):
| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/cadetes?grupoId=&estatus=` | lista del plantel |
| GET | `/api/cadetes/:matricula` | uno (404/403 según scope) |
| POST | `/api/cadetes` | crea `{matricula,nombreCompleto,grupoId,estatus?}` |
| PATCH | `/api/cadetes/:matricula` | actualiza nombre/grupo/estatus; RN-05 sella `fechaBaja` en baja |
| POST | `/api/cadetes/import` | `{registros:[…]}` o `{csv}` (texto) + `grupoIdPorDefecto?`; éxito parcial + dedup (DB y lote), reporta `{insertados, errores[]}` (RF-CAT-07) |
| POST | `/api/cadetes/import/archivo` | multipart `archivo` (`.csv`/`.xlsx` ≤ 2 MB) + `?grupoId=` opcional (grupo por defecto); misma lógica de import (RF-CAT-07) |

> `grupoIdPorDefecto` / `?grupoId=` se aplica a las filas **sin** `grupoId`; si la fila trae su
> propio `grupoId`, ese tiene prioridad (retrocompatible).

> El import por archivo usa `FileInterceptor` (Multer, incluido en `@nestjs/platform-express`)
> y **SheetJS (`xlsx`)** para `.xlsx`; el CSV se parsea sin dependencias. Se instala con
> `npm install`. El endpoint de texto (`{registros}`/`{csv}`) se conserva.

**Panel del docente** (RF-ASIG-04): `GET /api/docente/panel` → por curso del docente
autenticado: asistencia de hoy (capturada + conteo), parciales abiertos, cierres próximos (7 días).

**Reasignación de docente** (RF-ASIG-02): `PATCH /api/cursos/:id/docente` `{docenteId, motivo}`
(Coord/Op) — valida mismo plantel, registra en `audit_log` (`REASIGNAR_DOCENTE`, valor
anterior/nuevo + motivo) y preserva asistencias/calificaciones (referencian al curso, no al docente).

## Seguridad (I10, RNF-SEC)
- **Helmet** — cabeceras de seguridad en todas las respuestas (nosniff, frameguard, oculta
  `x-powered-by`, etc.).
- **CORS** — restringible por `CORS_ORIGIN` (lista separada por comas; vacío refleja el origen).
- **Rate-limit** (`@nestjs/throttler`) — por IP, `THROTTLE_LIMIT`/`THROTTLE_TTL` (default 1000/60s);
  complementa el bloqueo por usuario del login (RF-AUTH-05).
- Config compartida en `src/app.setup.ts` (`configurarApp`) usada por `main.ts` y las pruebas e2e.
- TLS 1.3 y cifrado at-rest (RNF-SEC-01/02) son responsabilidad del despliegue (reverse proxy + DB).

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
