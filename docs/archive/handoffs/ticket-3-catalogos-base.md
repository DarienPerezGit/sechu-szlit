# Handoff: Szlit Ticket #3 — Catálogos Base

**Date**: 2026-08-04  
**Session work**: Implemented GitHub issue #3 — catalog tables and read-only API endpoints  
**Repo**: `DarienPerezGit/sechu-szlit` (PUBLIC) — `C:\Users\PC\Proyectos\Szlit`

---

## Current state

Two stacked PRs are open on GitHub, ready for review/merge:

| PR | URL | Base ← Head | Issue |
|---|---|---|---|
| #16 | https://github.com/DarienPerezGit/sechu-szlit/pull/16 | `main` ← `feat/ticket-2-bootstrap-auth` | Closes #2 |
| #17 | https://github.com/DarienPerezGit/sechu-szlit/pull/17 | `feat/ticket-2-bootstrap-auth` ← `feat/ticket-3-catalogos-base` | Closes #3 |

**Merge order**:
1. Merge PR #16 first → both issues auto-close
2. GitHub auto-reparents PR #17 from `feat/ticket-2-bootstrap-auth` to `main`
3. Merge PR #17

Local `main` is synced with `origin/main` (`538dfc5 first commit`). Feature branches carry the work. No local commits are ahead of main.

---

## What was implemented (Ticket #3)

### Database (`packages/db/`)
- **Schema**: `packages/db/src/schema/catalogos.ts` — Three global catalog tables: `sectores`, `estados_caso`, `tipos_audiencia`. Serial IDs, `codigo UNIQUE`, `activo` (boolean, default true). `sectores` has `es_vertical` and `orden_pipeline` (nullable). `tipos_audiencia` has `color`.
- **Migration**: `packages/db/src/migrations/0000_aberrant_dakota_north.sql` — Consolidated DDL (`IF NOT EXISTS`, `DO $$ EXCEPTION WHEN duplicate_object`) + idempotent seeds (`ON CONFLICT (codigo) DO NOTHING`). The old `0000_seed.sql` was replaced; removed.
- **Migrate.ts**: `packages/db/src/migrate.ts` — Generalized to read all `*.sql` alphabetically via `readdirSync().filter().sort()`, executing each via `db.execute(sql.raw())`. Drizzle's `-->` markers are harmless PostgreSQL single-line comments.
- **copy-migrations**: `packages/db/package.json:16` — Cleaned build: `rmSync(dest, {recursive: true, force: true})` before `cpSync` to prevent stale phantom migrations.
- **drizzle.config.ts**: Schema path points to `./dist/schema/index.js` (not TS source) because drizzle-kit's CommonJS loader cannot resolve the `.js` ESM re-export extensions in source. Comment documents this.
- **vitest.config.ts**: Added `poolOptions.threads.singleThread: true` (matches `apps/api` config).

### API (`apps/api/`)
- **Routes**: `apps/api/src/routes/catalogos.ts` — Three read-only GET endpoints filtering `activo=true`: `/api/sectores`, `/api/estados-caso`, `/api/tipos-audiencia`. No auth required (global catalogs by design).
- **App.ts**: `apps/api/src/app.ts` — `catalogosRoutes` registered under `/api` prefix.
- **index.ts**: `apps/api/src/index.ts` — Fixed `envDir` path from `join(__dirname, "..", "..")` to `join(__dirname, "..", "..", "..")` so dev server finds `.env.local` at the repo root (was failing silently; server crashed with "DATABASE_URL is required"). Added `PORT=3005` to `.env.local` to avoid conflict with Atlas One ERP on port 3000.

### Tests
- `packages/db/tests/catalogos.test.ts` — DB-level: seed integrity, idempotency, UNIQUE code constraint enforcement.
- `apps/api/tests/catalogos.test.ts` — API-level: endpoint payloads, activo filter, `afterEach reactivateAll` for self-healing against persistent Neon DB on interrupted runs.
- All 14 workspace tests pass (3 db + 11 api).

---

## Architecture decisions & gotchas

1. **estudios seed uses `WHERE NOT EXISTS`, not `ON CONFLICT`**: `estudios` has no `UNIQUE` constraint on `nombre`. `ON CONFLICT DO NOTHING` (no target) re-inserts every run, breaking the "exactly one estudio" contract. The `WHERE NOT EXISTS` guard is intentional. A reviewer suggestion to change this was correctly rejected.
2. **Stale `packages/db/src/*.js` artifacts**: Old tsc output mixed with source files caused vitest to resolve outdated code. Cleaned via `find ... -delete`. The `.gitignore` was already configured to exclude these.
3. **`--> statement-breakpoint` is harmless**: Drizzle's marker is a valid PostgreSQL single-line comment. Safe inside a single `db.execute()` multi-statement raw execute via node-postgres. Confirmed during review.
4. **Neon persistent DB complications**: A failed experiment (`ON CONFLICT` on estudios mid-review) created 6 duplicate estudios rows. Cleaned manually via a throwaway script against Neon (`DELETE FROM estudios WHERE id NOT IN (SELECT id ORDER BY id LIMIT 1)`).
5. **Lifecycle gate**: `git commit` is blocked by the harness without a native durable review receipt. The user committed manually outside the harness in PowerShell.

---

## Review context

A substantive 4-lens review was executed via independent subagent reviewers (review-risk, review-resilience, review-readability, review-reliability). 22 findings. One correction round applied 6 fixes (documented in commit `aa00223`). The native `gentle_review FINALIZE` transaction failed to persist the durable receipt (operational bug: workspace tree mutated during correction, delta against frozen START tree didn't resolve). The review evidence is substantive, not a native receipt. Reference PR #17 body for details.

---

## Next tickets (all open, labeled `ready-for-agent`)

- **#4** — Ticket 3: Crear Carpeta (sin permisos de sector todavía)
- **#5** — Ticket 4: Audiencias con orphan tray
- **#6** — Ticket 5: Permisos por rol y sector
- Full list: https://github.com/DarienPerezGit/sechu-szlit/issues

---

## Suggested skills for the next agent

| Skill | Why |
|---|---|
| `gentle-ai` | Harness discipline for this repo: clarify first, TDD, delegate through subagents |
| `gentle-ai-issue-creation` | If new GitHub issues need creation |
| `gentle-ai-branch-pr` | Creating PRs with issue-first checks |
| `gentle-ai-chained-pr` | If the next ticket results in >400 lines or stacked PRs |
| `gentle-ai-judgment-day` | For adversarial dual review on critical changes |
| `work-unit-commits` | Planning commits as reviewable work units |
| `review` | Running code review since fixed points |
| `diagnose` | If bugs arise in the current implementation |

### Key artifacts to read first

- `C:\Users\PC\Proyectos\Szlit\AGENTS.md` — issue tracker and triage conventions
- `C:\Users\PC\Proyectos\Szlit\docs\agents\domain.md` — domain context layout
- `C:\Users\PC\Proyectos\Szlit\docs\adr\0001-accidentes-vertical-separada.md` — ADR on vertical separation
- `https://github.com/DarienPerezGit/sechu-szlit/issues/3` — Issue #3 (completed)
- `https://github.com/DarienPerezGit/sechu-szlit/issues/4` — Next: Issue #4
- `https://github.com/DarienPerezGit/sechu-szlit/pull/16` — PR #16 (bootstrap)
- `https://github.com/DarienPerezGit/sechu-szlit/pull/17` — PR #17 (catálogos)
