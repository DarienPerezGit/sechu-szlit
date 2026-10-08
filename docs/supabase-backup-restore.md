# Supabase Backup and Restore Runbook

**Issue:** #27 — Verificar backup y restauración de Supabase
**Scope:** the academic ("Seminario") Supabase project, independent of the application runtime
**Verified on:** 2026-09-27 against `sechub-test-validation` (East US / North Virginia, PostgreSQL 17.6.1.166)

Companion document: `docs/supabase-validation.md` (issue #26, the target validation this backup protects).

---

## 1. What this runbook proves

Every procedure below was executed end to end, **except section 5c**, which was not. The numbers in
this document are observed output, not estimates. Anything not run is marked unverified where it
appears.

| Check | Result |
| ----- | ------ |
| `pg_dump` backup produced | 393.9 KB custom-format archive, 698 TOC entries |
| Restored into a local PostgreSQL instance | 17 tables, 38 indexes, 9 migration rows |
| Restored into a scratch database on the project itself | 17 tables, 38 indexes, 9 migration rows |
| Row counts, source vs restored | 15 of 15 application tables match |
| Grant posture survives the restore | confirmed by `SET ROLE` probes, not by ACL arithmetic |

The archive contains **no credentials and no personal data**. Verified: zero matches for
`SCRAM-SHA-256`, zero for `md5<32 hex>`, zero for the database password, zero for the project
reference. Every hit for the string `password` is a column definition
(`usuarios.password_hash`, `auth.users.encrypted_password`) or a pgbouncer function body, never
a value. The rows that would carry PII are empty on this project: `usuarios` 0, `auth.users` 0,
`storage.buckets` 0, `storage.objects` 0.

> **On a project with real users this changes.** The archive does contain `COPY auth.users` and
> `COPY storage.objects` blocks. With data in them, the dump becomes a sensitive artifact holding
> email addresses and file metadata. Treat it accordingly. See section 8.

---

## 2. Required tooling

The PostgreSQL client tools are **not on `PATH` in this environment**. Invoke them by full path or
prepend it:

```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$env:Path"
```

| Tool | Version used | Note |
| ---- | ------------ | ---- |
| `pg_dump` | 18.4 (windows, msvc-19.44) | Newer than the 17.6 server, which is supported. `pg_dump` must be **at least** the server major version. |
| `pg_restore` | 18.4 | `pg_restore` requires `-d` explicitly. It does not read `PGDATABASE`. |
| `psql` | 18.4 | |
| PostgreSQL server (restore target) | 18.4 on `localhost:5432` | From `TEST_DATABASE_URL` in `.env.local`. |

Never put a connection string inline in a command. Export the password and let the tools read it:

```powershell
$env:PGPASSWORD = '<password>'
$env:PGUSER     = 'postgres.<project-ref>'
$env:PGHOST     = 'aws-0-<region>.pooler.supabase.com'
$env:PGPORT     = '5432'
$env:PGSSLMODE  = 'prefer'
```

---

## 3. Connection mode

**Use the Session pooler on port 5432.** That is the mode validated in issue #26 and the same one
the migration runner uses.

The commonly repeated claim that `pg_dump` *requires* a session pooler and breaks on the
transaction pooler did **not** reproduce here. Both were tested against the same project:

| Mode | Port | `pg_dump` exit code | Archive size | TOC entries |
| ---- | ---- | ------------------- | ------------ | ----------- |
| Session pooler | 5432 | 0 | 393.9 KB | 698 |
| Transaction pooler | 6543 | 0 | 393.9 KB | 698 |

Identical output. So 5432 is the recommendation on **correctness grounds, not compatibility**: a
transaction-mode pooler may hand successive statements of one `pg_dump` to different backends with
different snapshots, so a backup taken under concurrent write traffic can tear. A backup that can
tear is not a backup. The test above was a single-shot dump against an idle project and cannot
detect that failure mode.

Do not use the Supabase **direct** connection (`db.<ref>.supabase.co`) for this either. From #26 it
already exhibited IPv6 resolution problems under Node.

---

## 4. Backup

```powershell
$out = "$env:TEMP\sechub-27"
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }
Set-Location $out

pg_dump -Fc -f sechub.dump `
  --no-owner `
  -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d postgres
```

`-Fc` is custom format. It is the right choice here because `pg_restore` can then select
individual objects, which section 5 requires. Use `-Fp` only when you want a file you can read.

`--no-owner` is deliberate: it strips `ALTER ... OWNER TO supabase_admin`, which is what lets the
archive restore into a target where that role does not exist.

**Expected content:** 17 tables in `public`, 38 indexes, 1 function, 9 rows in
`__sechub_migrations`. The archive also carries Supabase's own objects (`auth`, `storage`,
`graphql`, a `PUBLICATION`, 4 extensions) because a `pg_dump` of the `postgres` database is a
full-database dump. That is why section 5 filters by schema.

**Do not commit the archive.** It belongs outside the repository.

---

## 5. Restore

Two targets were tested end to end (5a and 5b). A third, `supabase start`, is documented in 5c but
could not be executed because Docker was unavailable; it is marked unverified.

### 5a. Scratch database on the project itself

Most faithful: every Supabase role and extension is present by construction, and the existing
database is never touched.

```powershell
# 1. Scratch database
psql -d postgres -q -c "CREATE DATABASE sechub_restore_probe;"

# 2. Filter the table of contents: drop the 24 DEFAULT ACL entries.
#    See "Restore limitation 1" below for why they cannot be replayed.
pg_restore --list sechub.dump | Where-Object { $_ -notmatch "DEFAULT ACL" } |
    Out-File -FilePath toc-filtered.txt -Encoding ascii

# 3. Restore atomically
pg_restore -d sechub_restore_probe `
    --schema=public `
    --no-owner `
    --single-transaction `
    -L toc-filtered.txt `
    sechub.dump

# 4. Clean up
psql -d postgres -q -c "DROP DATABASE sechub_restore_probe WITH (FORCE);"
```

`--single-transaction` is not optional in practice. Without it `pg_restore` applies objects one
statement at a time, so a mid-way failure leaves a half-populated database that then fails the
*next* attempt on `function "uuidv7" already exists`. That happened during this exercise. With
`--single-transaction` a failure rolls back whole and the target is immediately reusable.

Note `-L` is **capital** L. `-l` is `--list`, which takes no argument and makes `pg_restore` treat
the archive name as a command.

### 5b. Local PostgreSQL instance

Proves the archive survives leaving Supabase. Needs two things the vanilla local server lacks.

```powershell
# 1. The four Supabase roles, as NOLOGIN. The archive grants to them, so they must exist.
foreach ($r in @("anon", "authenticated", "service_role", "authenticator")) {
    $exists = psql -h localhost -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$r';"
    if ($exists -ne "1") { psql -h localhost -U postgres -d postgres -q -c "CREATE ROLE $r NOLOGIN;" }
}

# 2. Membership, so the verification probes in section 6 can SET ROLE
psql -h localhost -U postgres -d postgres -q -c "GRANT anon, authenticated TO postgres;"

# 3. Target database
psql -h localhost -U postgres -d postgres -q -c "CREATE DATABASE sechub_local_restore;"

# 4. Filter out DEFAULT ACL *and* supabase_vault (26 entries total)
pg_restore --list sechub.dump |
    Where-Object { $_ -notmatch "DEFAULT ACL" -and $_ -notmatch "supabase_vault" } |
    Out-File -FilePath toc-local.txt -Encoding ascii

pg_restore -d sechub_local_restore `
    -h localhost -U postgres `
    --schema=public `
    --no-owner `
    --single-transaction `
    -L toc-local.txt `
    sechub.dump
```

`pg_restore` takes `-h` and `-U` explicitly for the same reason the setup `psql` calls above do:
section 2 left `PGHOST` and `PGUSER` pointing at the Supabase pooler, and libpq would otherwise send this
restore to the project instead of localhost, defeating the entire point of this target.

### 5c. Local Supabase stack via `supabase start`

**Not verified.** Docker was not runnable in the environment where this runbook was written, so
this path is documented from the CLI contract and should be treated as untested until someone runs
it.

It is exactly as faithful as 5a, with fewer manual setup steps, because `supabase start` brings up a
real platform: `anon`, `authenticated`, `service_role` and `supabase_vault` all exist by
construction, so none of the exclusions in 5b are needed and only the 24 `DEFAULT ACL` entries must
still be filtered.

```powershell
supabase start
# The local stack listens on 54322, not 5432.
$env:PGUSER     = 'postgres'
$env:PGHOST     = 'localhost'
$env:PGPORT     = '54322'
$env:PGPASSWORD = 'postgres'

psql -d postgres -q -c "CREATE DATABASE sechub_supabase_restore;"

pg_restore --list sechub.dump | Where-Object { $_ -notmatch "DEFAULT ACL" } |
    Out-File -FilePath toc-supabase.txt -Encoding ascii

pg_restore -d sechub_supabase_restore `
    --schema=public `
    --no-owner `
    --single-transaction `
    -L toc-supabase.txt `
    sechub.dump
```

The archive was taken from a **hosted** project, so a restore into `supabase start` also carries
the risk in limitation 2: drop `sechub_supabase_restore` when finished rather than restoring
platform schemas on top of a live local stack.

---

## 6. Verification

Check the restore three ways. The third is the one that matters.

**Structure and row counts**

```powershell
$q = "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relkind='r') AS tables,
             (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
             (SELECT count(*) FROM __sechub_migrations) AS migrations;"
psql -d sechub_restore_probe -tAc $q     # 17 | 38 | 9
```

**Do not compare with `pg_stat_user_tables`.** It is schema-agnostic, so on the source it also
returns Supabase's platform tables (`auth.users`, `storage.buckets`, ...). Comparing that against
the restored database reports a false mismatch. Count per table in `public` instead.

**Grant posture, with `SET ROLE`**

`has_table_privilege()` is ACL arithmetic. Probing as the role itself tests real access:

```powershell
psql -d sechub_restore_probe -tA -c "SET ROLE authenticated; SELECT count(*) FROM public.sectores;"
# 6

psql -d sechub_restore_probe -tA -c "SET ROLE anon; SELECT count(*) FROM public.sectores;"
# ERROR: permission denied for table sectores

psql -d sechub_restore_probe -tA -c "SET ROLE authenticated; SELECT count(*) FROM public.estudios;"
# ERROR: permission denied for table estudios

psql -d sechub_restore_probe -tA -c "SET ROLE authenticated; INSERT INTO public.roles (nombre) VALUES ('x');"
# ERROR: permission denied for table roles
```

Expected: `authenticated` reads the 6 catalogs and nothing else; `anon` reads nothing; nobody
writes. The local server may report these as `permiso denegado` instead of `permission denied`
depending on `lc_messages`, so match on either.

---

## 7. Pause, recovery, and timing before the presentation

### 7.1 What actually triggers a pause

The Free plan pauses a project after a week of low activity. **It is not an idle timer.** Supabase
defines inactivity as insufficient *user database activity* over a rolling 7-day window, and warns
explicitly:

> "While you may be actively using the project, it's possible that usage is not enough to exclude it
> from automatic pausing."

So visiting the dashboard once a week may not keep the project alive. The cheapest keep-alive that is
sufficient under every documented definition is a real query against the database, once a day.

Supabase sends two emails: a warning roughly a week before the pause, and a confirmation once it has
happened. Resuming inside the warning window avoids the pause entirely. Paid plans are never paused
for inactivity.

> Sources: [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
> [pricing](https://supabase.com/pricing). Full analysis with quotes in
> [`docs/research/supabase-pause-recovery.md`](research/supabase-pause-recovery.md).

### 7.2 Detecting a pause

**A paused project reports `status: "INACTIVE"`. There is no `PAUSED` value in the status enum** —
grepping for `PAUSED` finds only `PAUSING`, the transient in-flight state, and leads to the wrong
conclusion.

```bash
curl "https://api.supabase.com/v1/projects/$PROJECT_REF" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Or via the CLI, which requires `-o json` — **the default table has no status column and renders a
paused project identically to a healthy one**:

```bash
supabase projects list -o json | jq -r '.[] | select(.id=="'"$PROJECT_REF"'") | .status'
```

> **A refused connection is a symptom, not a diagnosis.** Three distinct documented causes produce
> it, and Supabase's own troubleshooting page attributes connection-refused to Fail2ban IP bans —
> a completely different remedy. Two other conditions look identical from outside but are *not* a
> pause: read-only mode, which Free projects enter at **500 MB** database size and which reports
> `SQLSTATE 25006`, and Fair Use restriction, which returns `402`. A running-but-read-only project
> and a paused project both look like "the app is broken"; their fixes are opposite.

### 7.3 Recovering a paused project

Resume first, then restore. Do not assume a paused project can accept a restore.

**Dashboard** — organization → paused project → **Resume project** → confirm. The project returns to
its previous state including data and configuration. Note the pause control lives under
*Settings → General → Project availability* while the resume control does not.

**Management API** — the scriptable path:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/restore" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Requires `projects:write`, or `project_admin_write` on a fine-grained token. The **200 response body
is empty** — there is no status field in it. Poll instead:

```bash
# watch RESTORING -> ACTIVE_HEALTHY
curl "https://api.supabase.com/v1/projects/$PROJECT_REF" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

**There is no CLI equivalent.** `supabase projects` has no pause or unpause subcommand, verified
against both the CLI reference and the CLI source tree. `supabase branches unpause` exists but
operates on preview branches, and branch resume is on-demand-on-first-request — a different
mechanism entirely. Do not substitute one for the other.

Supabase publishes **no duration** for a resume. Do not quote one. Resume is asynchronous — the
`RESTORING` and `RESTORE_FAILED` states exist in the status enum — so the procedure is to poll, not
to wait a guessed number of minutes. Measuring the real duration on this project is an open task; see
the research doc, section 11.

### 7.4 Sequence

| When | Action |
| ---- | ------ |
| **7 days before** | Confirm `status` is `ACTIVE_HEALTHY`. Watch for the warning email — a resume inside that window avoids the pause entirely. |
| **48 hours before** | Take the backup in section 4. Store it off the presentation machine. |
| **24 hours before** | Take a second backup, so you have a copy that predates the last day of demos. |
| **2 hours before** | Run the verification in section 6 against a scratch database. This is the rehearsal, not a formality. |
| **30 minutes before** | Confirm the API reaches the database. `pnpm db:migrate` should report `Database is up to date`. |
| **During** | Nothing. Do not run migrations mid-presentation. |

### 7.5 Do not depend on the platform restore window

Supabase's documentation contradicts itself on how long a paused project stays restorable. The live
guides say **1 year**, but the same page's heading is anchored `#90-day-window-to-restore`, a
troubleshooting page titled "Restored for More Than 1 Year" sits at the slug `…after-90-days-pause`,
and the only changelog record of the policy still says **90 days**. No changelog entry announces the
change to 1 year.

The current documented window is 1 year, but do not build a procedure on the difference. This is the
argument for the discipline above rather than against it: a `pg_dump` archive is timestamped, stored
off the presentation machine, and yours. The platform-side artifact is a single snapshot from an
unknown time in the past. A project paused the week before a demo is not a data-loss event; a project
left paused for a term is. Analysis in
[`docs/research/supabase-pause-recovery.md`](research/supabase-pause-recovery.md), section 8.

---

## 8. Restore limitations and data-loss expectations

Stated plainly, because a runbook that overstates its coverage is worse than none.

**Limitation 1 — `DEFAULT ACL` entries cannot be replayed.** The archive contains 24 of them, for
example:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
```

`postgres` is not a superuser on Supabase and lacks the right to alter another role's default
privileges, so replaying these fails with `permission denied to change default privileges`. They
are filtered out. **Consequence:** the restore does not reproduce the target's default-privilege
configuration. The archive does not either — it only captured the current `pg_default_acl`, not
Supabase's bootstrap definition.

**Limitation 2 — restoring into another Supabase project's `postgres` database is not supported by
this procedure.** A full-database archive carries `auth`, `storage`, `graphql`, event triggers and
a `PUBLICATION`. Replaying those into a live project collides with the platform's own objects.
This runbook restores `--schema=public` only, which is why it is safe.

**Limitation 3 — the archive is not a point-in-time recovery mechanism.** `pg_dump` gives you one
consistent snapshot at one instant. It cannot undo a bad migration applied afterwards, and it has
no recovery target you can roll back to. For true PITR you need Supabase's platform backups,
restored from the dashboard, not `pg_restore`.

**Limitation 4 — platform-managed data is out of scope for this schema filter.** `--schema=public`
does not carry `auth.users` credentials or `storage.objects`. If you restore with that filter, the
database is structurally complete but **all Supabase Auth accounts and all stored files are
absent.** Restore without the filter only into a database you have already discarded.

**Data-loss expectation.** A restore from this archive gives you the schema, the catalog seed data
(`sectores`, `roles`, `estados_caso`, `tipos_acta`, `tipos_audiencia`, `estados_acta`) and every row
that existed in `public` at dump time. It does not preserve RLS policy bindings you defined
outside the dumped schema, nor any state held in Supabase's control plane (project settings, edge
function environment variables, auth provider configuration). Those come from the dashboard or
from `supabase config`.

**Timing.** A 0.4 MB archive restores in seconds. At the volumes this project is designed for,
dump and restore are not a scheduling concern; the real risk is the 7-day pause, not dump duration.

---

## 9. Open security finding: `supabase_admin` default privileges

Found while building this runbook. It is **not** fixed by anything in this document.

`pg_default_acl` on the validated project:

```
supabase_admin | r | anon=arwdDxtm, authenticated=arwdDxtm   (tables)
supabase_admin | S | anon=rwU,     authenticated=rwU          (sequences)
supabase_admin | f | anon=X,       authenticated=X            (functions)
```

Migration `0008_secure_frontend_grants.sql` revokes default privileges **without `FOR ROLE`**, which
applies only to objects created by the role running the migration, which is `postgres`. The
`supabase_admin` defaults are therefore untouched. Any object created in `public` by
`supabase_admin` is still granted `ALL` to `anon` and `authenticated`.

The fix cannot be applied from the application role:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
-- ERROR:  permission denied to change default privileges
```

Why the existing tests do not catch it: `0008` is a no-op on the vanilla local and CI PostgreSQL,
which have neither `anon` nor `authenticated`. And the probe in issue #26 was created as
`postgres`, which is the one role `0008` does cover.

Practical exposure today is low, because migrations run as `postgres` and create the application's
own tables. It becomes real the moment a Supabase platform feature creates a table in `public` as
`supabase_admin`. Options, in order of preference:

1. Ask Supabase support whether these defaults can be narrowed on the project.
2. Never let `supabase_admin` own an object in `public`; keep app objects owned by `postgres`.
3. Add a CI check that fails when `pg_default_acl` grants anything to `anon` or `authenticated`
   for a role other than `postgres`.

This warrants its own issue. It is not a #27 acceptance criterion and not a reason to delay #27.

**Tracked as [#46](https://github.com/DarienPerezGit/sechu-szlit/issues/46).**
