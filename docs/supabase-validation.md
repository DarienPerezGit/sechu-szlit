# Supabase PostgreSQL Validation for Seminario

**Date:** 2026-09-27  
**Project:** `sechub-test-validation` — throwaway project, deleted after validation  
**Region:** us-east-1  
**PostgreSQL Version:** 17.6.1.166

## Validation Checklist (Issue #26)

### ✅ 1. PostgreSQL Extensions & Native uuidv7() Behavior

**Verified:**
- `uuidv7()` function works correctly (created by migration 0000 as fallback for PG17)
- Extensions available: `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault`
- UUIDv7 compatibility DDL executes without errors on both PG17 and PG18 paths

**Test:**
```sql
SELECT uuidv7(); -- Returns valid RFC 9562 UUIDv7
```

### ✅ 2. Runtime Connection via Supabase Pooler

**Verified:**
- Session pooler (transaction mode, port 5432) connects successfully
- Connection string format: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
- SSL with `rejectUnauthorized: false` works for pooler certificate chain

### ✅ 3. Administrative Migration Connectivity Separated

**Verified:**
- Direct connection (port 5432) resolves but DNS issues in Node.js IPv6 resolution
- Session pooler (port 5432) used successfully for migrations as fallback
- Per README: "si el entorno admin solo tiene IPv4, usá el Session pooler en el puerto 5432"
- Migration CLI executes all 8 migrations via session pooler without errors

### ✅ 4. Complete Migration History on Empty Database

**Verified:**
- All 8 migrations (0000–0007) apply cleanly on fresh database
- Migration metadata table `__sechub_migrations` created and populated
- Legacy adoption path (migrations 0000–0006) not needed on fresh DB

**Applied Migrations:**
1. `0000_aberrant_dakota_north.sql` - Core schema + uuidv7 fallback
2. `0001_thankful_meggan.sql` - Additional tables
3. `0002_wild_doctor_faustus.sql` - More schema
4. `0003_wealthy_iron_monger.sql` - More schema
5. `0004_brief_mesmero.sql` - More schema
6. `0005_role_sector_permissions.sql` - RBAC tables
7. `0006_actas_orphan_tray.sql` - Actas + orphan tray
8. `0007_drop_usuarios_role.sql` - Drop legacy `usuarios.role` column

Migration `0008_secure_frontend_grants.sql` was written after this validation run,
from the manual grant fix below, so the fix is reproducible on any database.

### ✅ 5. Idempotent on Current Database

**Verified:**
- Re-running `pnpm db:migrate` returns "Database is up to date"
- No duplicate migration entries in metadata table
- SHA256 integrity checks pass

### ✅ 6. Grants for anon & authenticated Reviewed

**Fixed:**
- Default Supabase grants gave FULL access (ALL PRIVILEGES) to both `anon` and `authenticated` on ALL tables
- **Revoked ALL on every table first**, then granted the read-only catalogs back. Order matters: a `GRANT SELECT` on top of Supabase's default `ALL` is a no-op, so any catalog that was never revoked stayed fully writable.
- **Granted SELECT only** to `authenticated` on 6 catalog/lookup tables:
  - `sectores`, `estados_caso`, `roles`, `tipos_acta`, `tipos_audiencia`, `estados_acta`
- **`anon` has zero table access** (no table exposure at all)
- Fully sealed for both roles: `carpetas`, `actas`, `audiencias`, `usuarios`, `usuarios_roles`, `usuarios_sectores`, `bitacora_carpetas`, `empleadores`, `sessions`, `estudios`, `__sechub_migrations`
- `estudios` is sealed on purpose. It is the tenant boundary, not a lookup value, so the browser has no business reading it directly. The old fix exposed it read-only; that was a wrong call and it is reverted here.
- All `anon` and `authenticated` sequence privileges revoked
- **Revoked `ALTER DEFAULT PRIVILEGES` for both roles**, otherwise the next migration that creates a table silently reopens the exposure

**Reproducibility:** a one-time `REVOKE` is not enough on Supabase, because the
default privileges are re-applied to every table created afterwards. The fix is
now migration `0008_secure_frontend_grants.sql`, applied by `pnpm db:migrate`.

**Verified after applying:** 11 sealed tables have zero privileges for both roles,
6 catalogs are SELECT-only for `authenticated` and zero for `anon`, 0 sequences
are usable, and a probe table created *after* the migration is invisible to both
roles. Re-running `pnpm db:migrate` reports "Database is up to date".

### ✅ 7. RLS Explicitly Documented as Deferred

**Status:** **DEFERRED** — Not implemented as duplicate authorization system

**Rationale:**
- SECHUB is currently monotenant (single estudio)
- Authorization enforced at application layer (Fastify + Drizzle)
- Row-Level Security policies (`{tabla}_estudio_isolation`) are pre-named but **disabled** in production
- RLS would duplicate authorization logic already in API layer
- When multi-tenancy is required, RLS policies will be enabled via explicit migration

**Tables with pre-named RLS policies (disabled):**
- `carpetas_estudio_isolation`
- `actas_estudio_isolation`
- `audiencias_estudio_isolation`
- `bitacora_carpetas_estudio_isolation`
- `empleadores_estudio_isolation`
- `usuarios_estudio_isolation`
- `sessions_estudio_isolation`

**Implementation plan for future multi-tenancy:**
1. Enable RLS: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`
2. Create policies using `estudio_id` from session context
3. Use `current_setting('app.estudio_id')` for tenant isolation

### ✅ 8. Academic Scope & graphile-worker Deferral Documented

**Academic/Non-Commercial Scope:**
- This validation targets the **Seminario** academic environment
- Non-commercial usage: no SLA requirements, no billing concerns
- Free-tier Supabase project sufficient for validation
- No production data — only test fixtures

**graphile-worker Deferral:**
- Background job processing via `graphile-worker` (PostgreSQL-based, no Redis)
- **Deferred to post-validation phase** (after issue #30-31)
- Current validation focuses on schema, connections, and permissions
- Worker will use same `DATABASE_URL` (session pooler) for job queue
- Polling interval: 30 minutes for Gmail/Calendar sync (future)

---

## Connection Reference (Test Project)

Credentials for the test project are redacted. `supabase link` writes them to
`supabase/.temp/` (git-ignored); the project itself was deleted after validation.

| Purpose | Connection String |
|---------|-------------------|
| **Runtime (API)** | `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| **Migrations (Admin)** | Same as runtime (session pooler fallback) |
| **Direct (if needed)** | `postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres` |

---

## Next Steps

1. **Issue #27** — Verify backup/restore of Supabase (pg_dump / Supabase dashboard)
2. **Issue #28** — Link Supabase Auth identity with internal `usuarios` profiles
3. **Issue #29** — Bearer Supabase JWT + dynamic authorization in Fastify
4. **Issue #30** — Integrate Supabase session in frontend
5. **Issue #31** — Atomic auth cutover
6. **Issue #32** — Deploy Vercel Hobby

---

## Cleanup

Test project `sechub-test-validation` is still running. It is disposable and
can be deleted once you no longer need it to re-verify the grants:
```bash
supabase projects delete <project-ref>
```

Deleting it loses nothing that matters: migration `0008_secure_frontend_grants.sql`
now reproduces the grants on any Supabase project.
