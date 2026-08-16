# Handoff: Szlit Ticket #4 (Audiencias con orphan tray) — Cierre

**Date**: 2026-08-08  
**Project**: sechu-szlit  
**Branch**: `feat/ticket-5-audiencias-orphan-tray`  
**Base**: `main` (bbfb67e)  
**Issue**: [#5](https://github.com/DarienPerezGit/sechu-szlit/issues/5) — Ticket 4: Audiencias con orphan tray

---

## Accomplished

1. **Tabla `audiencias`** (`packages/db/src/schema/audiencias.ts`):
   - UUIDv7 PK, FK a `estudios`, `carpetas` (nullable), `usuarios`, `tipos_audiencia`.
   - Índices compuestos: `(estudio_id, fecha, hora)` y `(estudio_id, carpeta_id)`.
   - Migración idempotente autogenerada (`0004_brief_mesmero.sql`).

2. **5 tests de DB** (`packages/db/tests/audiencias.test.ts`):
   - Creación con/sin carpeta, constraints FK, orden agenda, vinculación con bitácora.

3. **4 endpoints API** (`apps/api/src/routes/audiencias.ts`):
   - `POST /api/audiencias` — crea audiencia (valida abogado y carpeta ownership).
   - `GET /api/audiencias?fecha=YYYY-MM-DD` — agenda del día con LEFT JOIN (blindado contra cross-tenant leaks).
   - `GET /api/audiencias/orphan` — bandeja de huérfanas ordenada.
   - `PATCH /api/audiencias/:id/vincular` — vincula huérfana a carpeta con bitácora transaccional.

4. **6 tests de API** (`apps/api/tests/audiencias.test.ts`):
   - 401 unauthenticated, creación con/sin carpeta, agenda ordenada, orphan tray, vinculación con bitácora, cross-tenant isolation.

5. **Code review** (Standards + Spec):
   - Hallazgos menores documentados.
   - Fix de seguridad aplicado: LEFT JOIN en agenda incluye validación `carpetas.estudioId = user.estudioId`.

### Commits

```
3232030 feat(api): add audiencias endpoints with orphan tray and cross-tenant isolation
<sha>    feat(db): add audiencias table with idempotent migration
<sha>    fix(api): secure left join in audiencias agenda against cross-tenant leaks
```

---

## Test Status

| Suite | Files | Tests | Status |
|---|---|---|---|
| DB (`packages/db/tests/`) | 4 | 10 (5 audiencias + 2 carpetas + 1 catálogos + 2 schema) | ✅ |
| API (`apps/api/tests/`) | 4 | 19 (6 audiencias + 2 carpetas + 3 catálogos + 8 auth) | ✅ |
| **Total** | **8** | **29** | ✅ |

---

## Key Files

| File | Purpose |
|---|---|
| `packages/db/src/schema/audiencias.ts` | Schema definition |
| `packages/db/src/migrations/0004_brief_mesmero.sql` | Idempotent migration |
| `packages/db/tests/audiencias.test.ts` | DB tests |
| `apps/api/src/routes/audiencias.ts` | API routes |
| `apps/api/tests/audiencias.test.ts` | API tests |
| `apps/api/src/app.ts` | Route registration |
| `apps/api/tests/helpers/db.ts` | Test helpers (updated reset) |
| `docs/prd/ticket-4-audiencias-orphan-tray.md` | PRD (reference) |

---

## Next Steps

1. **Push & PR**:
   ```bash
   git push origin feat/ticket-5-audiencias-orphan-tray
   ```
   Crear PR contra `main` (closes #5).

2. **Ticket 5: Permisos por rol y sector (Issue #6)**:
   - PRD en `docs/prd/ticket-5-permisos-rol-sector.md`.
   - Requiere nuevo schema de permisos, migración, y endpoints de RBAC.

---

## Suggested Skills

- `gentle-ai` — harness discipline and review.
- `work-unit-commits` — commits reviewables por work unit.
- `code-review` — two-axis review (Standards + Spec).
- `tdd` — strict red-green-refactor.
