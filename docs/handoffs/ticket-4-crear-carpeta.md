# Handoff: Szlit Ticket #4 — Crear Carpeta (sin permisos de sector todavía)

**Date**: 2026-08-04  
**Session work**: Implemented GitHub issue #4 — folders and folders' log tables, API routes, optimistic locking, and test coverage  
**Repo**: `DarienPerezGit/sechu-szlit` — Branch: `feat/ticket-4-crear-carpeta`

---

## What was implemented (Ticket #4)

### Database (`packages/db/`)
- **Schema**:
  - `packages/db/src/schema/empleadores.ts` — Defined the `empleadores` table schema according to Ticket 8 specs so that `empleador_id` in `carpetas` can be a valid PG foreign key.
  - `packages/db/src/schema/carpetas.ts` — Defined `carpetas` (with UUIDv7 PK, `estudio_id` FK, `sector_actual_id` FK, `estado_caso_id` FK, `version` optimistic locking column, `expediente` UNIQUE varchar, `caratula` text, `demandada` text, `empleador_id` FK) and `bitacora_carpetas` tables.
- **Migrations**:
  - `0001_thankful_meggan.sql` — Created tables and constraints.
  - `0002_wild_doctor_faustus.sql` — Added indices on `bitacora_carpetas(carpeta_id)` and `bitacora_carpetas(usuario_id)` to resolve performance concerns raised during lens reviews.
- **Tests**:
  - `packages/db/tests/carpetas.test.ts` — Verifies transaction safety on creation, log insertion, and asserts that version-based optimistic locking prevents concurrent updates with stale data.

### API (`apps/api/`)
- **Routes**: `apps/api/src/routes/carpetas.ts` — Enpoints for:
  - `GET /api/carpetas` — Lists folders filtering by logged-in user's `estudioId`.
  - `GET /api/carpetas/:id` — Retrieves a specific folder checking study ownership.
  - `POST /api/carpetas` — Creates folder and inserts log in transaction. Checks `empleadorId` study ownership for security.
  - `PATCH /api/carpetas/:id` — Sanitizes body to prevent mass-assignment, verifies `empleadorId` study ownership, and performs update + logs to bitacora using a transaction and optimistic locking. Returns `409` Conflict when version mismatches.
- **Deduplication**: `apps/api/src/utils/auth.ts` — Extracted `getAuthenticatedUser` helper, UUID regex, cookie options, and session cookie name constants to eliminate duplication across `auth.ts` and `carpetas.ts`.
- **Tests**:
  - `apps/api/tests/carpetas.test.ts` — Full API test suite covering unauthenticated denials, CRUD validation, transaction checks, and optimistic locking conflict returns.
  - `apps/api/tests/helpers/db.ts` — Updated to clean up `bitacora_carpetas`, `carpetas`, and `empleadores` tables before users and sessions to prevent foreign key violations.

### Workspace Configuration
- **Tests Serialization**: Updated root `package.json` test script to use `pnpm -r --concurrency=1 test` to avoid DB concurrency pollution on Neon.

---

## Verification & Status

All 18 tests (5 db + 13 api) are passing successfully on the live Neon DB.
A review lineage was successfully created, lens reviews run, and finalized. Code is in a review-ready state, unstaged, and uncommitted on the branch `feat/ticket-4-crear-carpeta`.
