# SECHUB

Sistema de gestión para estudios jurídicos laborales: unifica agenda de audiencias, legajos de casos, liquidaciones laborales y actas SECLO en una sola plataforma.

![build](https://img.shields.io/badge/build-passing-3B6D11) ![coverage](https://img.shields.io/badge/coverage-0%25-A32D2D) ![version](https://img.shields.io/badge/version-0.1.0-185FA5) ![license](https://img.shields.io/badge/license-privado-6b6b66)

## Quick start

```bash
git clone <repo> && cd sechub
pnpm install
npx neonctl@latest init      # autentica contra Neon y genera .env.local con DATABASE_URL
pnpm db:migrate
pnpm dev
```

La app queda arriba en `http://localhost:3000` (Fastify sirviendo tanto la API REST en `/api/*` como el frontend estático).

**Alternativa local con Docker** (sin Neon): `docker compose up -d postgres`, copiar `.env.example` a `.env.local` y ajustar `DATABASE_URL`.

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
- **Sesión**: Cookies de sesión más seguras (`httpOnly` + `SameSite=Strict`). Autenticación local mediante email y contraseña propia.
- **Workers**: Ejecución en segundo plano vía **graphile-worker** directamente sobre Postgres (sin Redis). Tareas de polling de Gmail/Calendar cada 30 minutos.
- **ORM**: Drizzle ORM con migraciones SQL explícitas y control directo de transacciones.
- **DB (Aislamiento)**: PostgreSQL. Diseño "tenant-ready" con columna `estudio_id` (not null + FK) e índices compuestos empezando por `estudio_id` en todas las tablas núcleo. Tipado en TypeScript que exige `estudio_id` a nivel de compilación en toda query. Row-Level Security (RLS) diferido: políticas pre-nombradas (`{tabla}_estudio_isolation`) pero desactivadas en producción inicial al ser hoy monotenant.
- **Concurrencia**: Bloqueo optimista (`version` integer) sobre la fila de `carpetas`. Tareas del checklist en tabla separada para evitar falsos conflictos. Retorna `409 Conflict` con "la carpeta cambió, recargá".
- **Liquidaciones**: Parámetros legales (`parametros_legales`) modelados con vigencia temporal (`valido_desde`/`valido_hasta`) y restricción de exclusión GiST contra solapamientos. Fórmula en código TS y snapshot inmutable `parametros_usados` (jsonb) en cada liquidación para auditoría legal.
- **Actas**: Tabla `actas` con expediente nullable y no-único (múltiples actas por expediente). Vínculo con carpetas por `carpeta_id` nullable (flujo de huérfanos). Transicionar `carpeta_id` de NULL a un valor corre en una transacción única los efectos secundarios (cambio de estado de carpeta, actualización de audiencias, log en bitácora).
- **Audiencias**: Agenda diaria con `carpeta_id` nullable (permite bloquear fechas sin carátula final). Audiencias sin carpeta son editables por cualquiera; al asociarse, heredan restricciones de sector del caso.

## Requisitos / setup local

- Node.js 20+, pnpm 9+
- Base de datos PostgreSQL 18:
  - **Neon** (recomendado para dev/scratch): `npx neonctl@latest init` genera `.env.local` con `DATABASE_URL`. Elegido sobre Supabase porque Neon es Postgres puro sin capa de API pública (PostgREST) que expondría cada tabla nueva salvo RLS activo por tabla.
  - **Docker local** (alternativa): `docker compose up -d postgres` (Postgres 18-alpine) y usar la `DATABASE_URL` de `.env.example`.
- Credenciales OAuth de Google Cloud (Gmail API + Calendar API) por cuenta del estudio (requerido solo para el worker de mail, fase posterior)

Variables de entorno (`.env.example` como plantilla; `.env` y `.env.local` están en `.gitignore`):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/sechub
COOKIE_SECRET=change-me-in-production-minimum-32-characters-long
NODE_ENV=development
PORT=3000
```

> **Aviso de datos:** la base de dev/scratch (Neon o Docker local) no debe contener datos reales del Estudio Szlit — solo expedientes y usuarios de prueba.

## Estructura de carpetas

```
sechub/
├── apps/
│   ├── api/          # Monolito Fastify (API + Static Frontend)
│   └── web/          # Frontend estático
├── packages/
│   └── db/           # Drizzle ORM, schema, migraciones SQL
├── docs/
│   ├── adr/          # Architecture Decision Records (ADRs)
│   └── agents/       # Issue tracker, triage, domain docs config
└── .env.example
```

## Tests

```bash
pnpm test              # unit + integration
```

> Nota: los tests de integración corren contra PostgreSQL 18 (Neon o Docker local). No se simulan múltiples tenants aún (eso viene con los tickets de permisos).

## Deploy / CI-CD

Despliegue en Railway (Postgres gestionado + servicio web monolito con worker en el mismo proceso o worker liviano dedicado, desactivado el sleep por inactividad). Respaldos automáticos de la plataforma complementados con un job de respaldo diario (`pg_dump`) hacia un bucket externo S3/Backblaze B2. Entornos aislados basados en branches (staging y producción) desde el primer día.

Residencia de datos (Ley 25.326) gobernada por consentimiento y cláusulas de transferencia internacional en el formulario de contratación (etapa Comunicaciones), no por región de nube.

## Contributing

Proyecto interno de Estudio Szlit. Cambios vía PR con revisión previa; ver `docs/adr/` antes de decisiones de arquitectura nuevas.

## License

Privado — uso exclusivo de Estudio Szlit. No redistribuir.
