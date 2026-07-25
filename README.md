# SECHUB

Sistema de gestión para estudios jurídicos laborales: unifica agenda de audiencias, legajos de casos, liquidaciones laborales y actas SECLO en una sola plataforma.

![build](https://img.shields.io/badge/build-passing-3B6D11) ![coverage](https://img.shields.io/badge/coverage-0%25-A32D2D) ![version](https://img.shields.io/badge/version-0.1.0-185FA5) ![license](https://img.shields.io/badge/license-privado-6b6b66)

## Quick start

```bash
git clone <repo> && cd sechub
cp .env.example .env
docker compose up -d        # levanta Postgres + Redis
pnpm install
pnpm db:migrate
pnpm dev
```

La API queda arriba en `http://localhost:3000`. El frontend PWA sirve desde `apps/web` en `http://localhost:5173`.

## Qué resuelve

Los estudios de derecho laboral llevan agenda, legajos y liquidaciones en sistemas sueltos (planillas, Drive, calculadoras aparte). SECHUB centraliza todo: una carátula genera automáticamente audiencia + carpeta de caso, un acta entrante actualiza el estado del caso solo, y las liquidaciones se precargan desde la carátula con la normativa laboral argentina (LCT, LNE, ley 25.323) ya codificada.

El caso, además, sigue un pipeline real por sectores: **Comunicaciones** (intake, decide si se toma) → **SECLO** (negociación) → si concilia, se archiva; si no, pasa por **Redacción** y **Procesal**. En paralelo puede abrirse un reclamo de **Accidentes**. Por fuera de este flujo hay dos verticales independientes: **Mediaciones civiles** (reclamos menores) y **Empleadores** (defensa cuando el cliente es la empresa).

## Arquitectura

```
Frontend PWA ──▶ API REST ──▶ PostgreSQL (tenant_id + RLS)
                    │              ▲
Gmail/Calendar ──▶ Workers ────────┘
   (OAuth por tenant, polling cada 30 min)
```

- **API**: Node.js/TypeScript (Fastify), stateless, JWT con claim `tenant_id`.
- **Workers**: BullMQ + Redis. Escanean Gmail y sincronizan Calendar por tenant.
- **DB**: PostgreSQL. Multi-tenant vía `tenant_id` en cada tabla + Row-Level Security — el aislamiento entre estudios se garantiza a nivel de motor de base de datos, no solo en el código de la API.

**Decisiones no obvias:**
- *Polling de Gmail cada 30 min, no push/webhooks*: Gmail push requiere Pub/Sub y verificación de dominio; para un caso de uso de agenda diaria (no tiempo real), polling es más simple de operar y suficiente.
- *RLS desde el día uno aunque hoy hay un solo tenant*: agregarlo después de tener datos reales de un estudio (legajos, montos, conciliadores) es una re-arquitectura, no un refactor. El costo extra ahora es ~15-20%.
- *Un solo servicio Node, no microservicios*: a esta escala (10 usuarios, pocos tenants) separar servicios agrega complejidad operativa sin beneficio real.
- *Roles por sector, no Admin/Usuario binario*: el estudio necesita administradores con edición total y responsables que solo editan los casos de su sector (comunicaciones, SECLO, redacción, procesal, accidentes). El schema de permisos se modela desde el arranque como rol + sector, no como un flag booleano.
- *El worker de mail lee varias casillas, no una sola*: cada sector usa su propia cuenta de Gmail/Hotmail. El `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` del `.env` siguen siendo uno solo (es la app registrada en Google Cloud); lo que cambia por casilla es el token de autorización, que se guarda en una tabla (`cuentas_mail`) y no en variables de entorno.

Ver `docs/SECHUB-BACKEND-SPEC.md` para el detalle de las 17 tablas y `docs/adr/` para decisiones futuras.

## Requisitos / setup local

- Node.js 20+, pnpm 9+
- Docker (Postgres 16 + Redis 7 vía `docker-compose.yml`)
- Credenciales OAuth de Google Cloud (Gmail API + Calendar API) por tenant

Variables de entorno (`.env.example`):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/sechub
REDIS_URL=redis://localhost:6379
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

## Estructura de carpetas

```
sechub/
├── apps/
│   ├── api/          # REST API (Fastify)
│   ├── workers/       # Jobs de Gmail/Calendar (BullMQ)
│   └── web/           # Frontend PWA
├── packages/
│   ├── db/            # Schema, migraciones, policies RLS
│   └── shared/         # Tipos y validaciones compartidas
├── docs/
│   ├── SECHUB-BACKEND-SPEC.md
│   └── adr/            # Architecture Decision Records
├── docker-compose.yml   # Postgres + Redis local
└── .env.example
```

## Tests

```bash
pnpm test              # unit + integration
pnpm test:e2e          # flujo completo (carátula → carpeta → audiencia)
```

## Deploy / CI-CD

Deploy inicial en Railway (Postgres + Redis + API + workers), HTTPS automático para la PWA. Pipeline: push a `main` corre lint + tests, deploy automático si pasan.

## Contributing

Proyecto interno de Estudio Szlit. Cambios vía PR con revisión previa; ver `docs/adr/` antes de decisiones de arquitectura nuevas.

## License

Privado — uso exclusivo de Estudio Szlit. No redistribuir.
