# SECHUB

Sistema de gestión para estudios jurídicos laborales: unifica agenda de audiencias, legajos de casos, liquidaciones laborales y actas SECLO en una sola plataforma.

![version](https://img.shields.io/badge/version-0.1.0-185FA5) ![license](https://img.shields.io/badge/license-privado-6b6b66)

## Quick start

```bash
git clone <repo> && cd sechub
pnpm install
# Configurá .env.local con DATABASE_URL y MIGRATION_DATABASE_URL (ver abajo)
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` es la única autoridad de migraciones para desarrollo local, CI y administración, y requiere `MIGRATION_DATABASE_URL` (no usa `DATABASE_URL`). En modo normal, una base existente sin metadata de migraciones falla cerrada y no se adopta automáticamente. Para una base legacy/current verificada, ejecutá una sola vez `pnpm db:migrate -- --adopt-existing`: comprueba el manifiesto legacy versionado, adopta la metadata histórica 0000..0006 y aplica las migraciones pendientes, incluida la eliminación de `usuarios.role`; luego el modo normal queda como no-op.

La app queda arriba en `http://localhost:3000` (Fastify sirviendo tanto la API REST en `/api/*` como el frontend estático).

**Alternativa local con Docker** (sin Supabase): `docker compose up -d postgres`, copiar `.env.example` a `.env.local` y ajustar `DATABASE_URL` y `MIGRATION_DATABASE_URL`.

## Qué resuelve

Los estudios de derecho laboral llevan agenda, legajos y liquidaciones en sistemas sueltos (planillas, Drive, calculadoras aparte). SECHUB centraliza todo: una carátula genera automáticamente audiencia + carpeta de caso, un acta entrante actualiza el estado del caso solo, y las liquidaciones se precargan desde la carátula con la normativa laboral argentina (LCT, LNE, ley 25.323) ya codificada.

El legajo operativo principal es la **Carpeta** (sinónimo de Caso en este dominio). Esta se mueve por un pipeline de sectores:
- **Comunicaciones** (intake, decide si se toma) → **SECLO** (negociación) → **Redacción** → **Procesal**.
- **Accidentes** corre como una vertical separada (reclamos ante comisiones médicas de la SRT contra la ART, circuito procesal independiente).
- **Mediaciones civiles** (reclamos menores, reutiliza la estructura de Carpeta pero en un sector aislado).
- **Empleadores** (defensa de clientes recurrentes, ficha liviana de cliente vinculable a Carpetas vía FK manual).

## Arquitectura

```
                       app.estudioszlit.com.ar
                  ┌───────────────────────────────┐
                  │  Fastify Monolith             │
Frontend estático ┼─▶ API REST ─▶ Drizzle ORM     │ ──▶ PostgreSQL (Postgres 18)
                  │                  │            │       (estudio_id tenant-ready)
                  │             graphile-worker ──┼───▶ Gmail/Calendar API
                  └───────────────────────────────┘       (OAuth por casilla)
```

- **Monolito**: Un solo deploy y dominio (`app.estudioszlit.com.ar`), sin CORS. Fastify sirve la API en `/api/*` y el frontend estático compilado vía `@fastify/static`.
- **Sesión**: Supabase Auth. El frontend inicia sesión con Supabase y llama a la API con `Authorization: Bearer <access_token>`; Fastify valida el token y resuelve el perfil interno (`usuarios.supabase_user_id`), sus roles y sectores. No hay contraseñas ni sesiones propias.
- **Workers**: Ejecución en segundo plano vía **graphile-worker** directamente sobre Postgres (sin Redis). Tareas de polling de Gmail/Calendar cada 30 minutos.
- **ORM**: Drizzle ORM con migraciones SQL explícitas y control directo de transacciones. La ejecución se realiza exclusivamente con `pnpm db:migrate`; Fastify no migra al iniciar.
- **DB (Aislamiento)**: PostgreSQL. Diseño "tenant-ready" con columna `estudio_id` (not null + FK) e índices compuestos empezando por `estudio_id` en todas las tablas núcleo. Tipado en TypeScript que exige `estudio_id` a nivel de compilación en toda query. Row-Level Security (RLS) diferido: políticas pre-nombradas (`{tabla}_estudio_isolation`) pero desactivadas en producción inicial al ser hoy monotenant.
- **Concurrencia**: Bloqueo optimista (`version` integer) sobre la fila de `carpetas`. Tareas del checklist en tabla separada para evitar falsos conflictos. Retorna `409 Conflict` con "la carpeta cambió, recargá".
- **Liquidaciones**: Parámetros legales (`parametros_legales`) modelados con vigencia temporal (`valido_desde`/`valido_hasta`) y restricción de exclusión GiST contra solapamientos. Fórmula en código TS y snapshot inmutable `parametros_usados` (jsonb) en cada liquidación para auditoría legal.
- **Actas**: Tabla `actas` con expediente nullable y no-único (múltiples actas por expediente). Vínculo con carpetas por `carpeta_id` nullable (flujo de huérfanos). Transicionar `carpeta_id` de NULL a un valor corre en una transacción única los efectos secundarios (cambio de estado de carpeta, actualización de audiencias, log en bitácora).
- **Audiencias**: Agenda diaria con `carpeta_id` nullable (permite bloquear fechas sin carátula final). Audiencias sin carpeta son editables por cualquiera; al asociarse, heredan restricciones de sector del caso.

## Requisitos / setup local

- Node.js 20+, pnpm 9+
- Base de datos PostgreSQL 17 o 18:
  - **Supabase**: `DATABASE_URL` usa el Session pooler para el runtime. Para administración y migraciones, `MIGRATION_DATABASE_URL` prefiere el endpoint directo; si el entorno admin solo tiene IPv4, usá el Session pooler en el puerto 5432. El Transaction pooler en el puerto 6543 no sirve para migraciones.
  - **Docker local** (alternativa): `docker compose up -d postgres` (Postgres 18-alpine) y usar las URLs de `.env.example`.
- Credenciales OAuth de Google Cloud (Gmail API + Calendar API) por cuenta del estudio (requerido solo para el worker de mail, fase posterior)

Variables de entorno (`.env.example` como plantilla; `.env` y `.env.local` están en `.gitignore`):

```bash
# Runtime: Supabase Session pooler (puerto 5432)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# Admin y migraciones: preferir el endpoint directo
MIGRATION_DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
# Supabase Auth (la API valida los Bearer tokens)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
# Tests: Postgres local de loopback (crea bases descartables)
TEST_DATABASE_URL=postgresql://postgres:<password>@localhost:5432/postgres
NODE_ENV=development
PORT=3000
```

El frontend lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` desde `apps/web/.env.local` (plantilla en `apps/web/.env.example`).

Para cargar datos de demo realistas a través de la API: `pnpm seed:demo` (ver `docs/demo-guion.md`).

> **Aviso de datos:** la base de dev/scratch (Supabase o Docker local) no debe contener datos reales del Estudio Szlit — solo expedientes y usuarios de prueba.

## Estructura de carpetas

```
sechub/
├── apps/
│   ├── api/          # Monolito Fastify (API + Static Frontend)
│   └── web/          # Frontend estático
├── packages/
│   └── db/           # Drizzle ORM, schema, migraciones SQL
├── api/              # Entrada serverless de Vercel (/api/* → Fastify)
├── docs/
│   ├── adr/          # Architecture Decision Records (ADRs)
│   ├── agents/       # Issue tracker, triage, domain docs config
│   ├── design/       # Prototipo visual original (HTML)
│   └── archive/      # PRDs y handoffs de tickets ya cerrados
├── scripts/          # smoke test, seed de demo, utilidades
└── .env.example
```

## Legacy schema verification

For a read-only dry run, run `pnpm db:verify-legacy --manifest packages/db/src/migrations/manifests/legacy-public-v1.json`. It validates the existing `public` schema, catalogs, and role backfill invariant without writing data or migration metadata. After it passes, explicit adoption is `pnpm db:migrate -- --adopt-existing`; it verifies the canonical shipped manifest, adopts metadata for 0000..0006, and applies pending SQL including 0007. Normal `pnpm db:migrate` never adopts a metadata-free existing schema.

### Rollback and restoration for migration 0007

Migration 0007 is destructive: it removes the legacy `usuarios.role` column after backfilling `usuarios_roles`. Create and verify a database backup before applying it. Rollback is only supported by restoring that backup; there is no reverse SQL migration that can recover the original scalar values.

In an emergency, `usuarios.role` can be reconstructed from `usuarios_roles` joined to `roles` only after defining and approving an explicit primary-role rule for users with multiple roles. Do not choose a primary role implicitly or from row order.

## Tests

```bash
pnpm test              # unit + integration
```

> Nota: `pnpm test` requiere `TEST_DATABASE_URL` apuntando a PostgreSQL local de loopback y crea bases descartables para el ciclo destructivo; no uses una base remota ni compartida. No se simulan múltiples tenants aún (eso viene con los tickets de permisos).

## Deploy / CI-CD

Despliegue en **Vercel Hobby** con un solo origen: el frontend estático se sirve desde la CDN y `/api/*` va a una función serverless que levanta Fastify (`api/index.ts`). La base es **Supabase PostgreSQL** a través del pooler. Configuración, variables y plan de contingencia local en [`docs/deployment-vercel.md`](docs/deployment-vercel.md); backups y recuperación ante pausas del plan Free en [`docs/supabase-backup-restore.md`](docs/supabase-backup-restore.md).

Las migraciones nunca corren en el deploy: se aplican con `pnpm db:migrate` usando `MIGRATION_DATABASE_URL`. Verificación post-deploy: `TARGET_URL=https://<deploy> pnpm smoke`.

Residencia de datos (Ley 25.326) gobernada por consentimiento y cláusulas de transferencia internacional en el formulario de contratación (etapa Comunicaciones), no por región de nube.

## Contributing

Proyecto interno de Estudio Szlit. Cambios vía PR con revisión previa; ver `docs/adr/` antes de decisiones de arquitectura nuevas.

## License

Privado — uso exclusivo de Estudio Szlit. No redistribuir.
