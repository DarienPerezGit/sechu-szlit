# Supabase Pause and Recovery — Primary-Source Research

**Purpose:** close the acceptance criterion in [GitHub issue #27](https://github.com/DarienPerezGit/sechu-szlit/issues/27) requiring that "Supabase pause/inactivity recovery steps are documented" for the `docs/supabase-backup-restore.md` runbook.

**Question investigated:** what are the real inactivity semantics of a Supabase Free-plan project, how is a paused project detected, and what officially supported paths exist to resume it?

**All sources accessed:** 2026-10-03.

**Source policy:** official Supabase documentation, the first-party Management API OpenAPI specification, and the first-party Supabase CLI source repository. No blog posts, no Stack Overflow, no community threads are used to establish a fact. Where a community report is the only thing that exists, it is labelled as such and is **not** treated as a fact.

---

## 1. The actual inactivity window

### 1.1 The 7-day number is correct — but the runbook mis-describes *what* it measures

The canonical page is [`/docs/guides/platform/free-project-pausing`](https://supabase.com/docs/guides/platform/free-project-pausing) (accessed 2026-10-03). Verbatim:

> "Supabase pauses Free Plan projects that show low activity over a 7-day period to save server resources. This guide explains how pausing works, how to restore a paused project, and how to avoid pausing altogether."

> "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week. Projects with too few user queries during that window are the clearest candidates for pausing. While you may be actively using the project, it's possible that usage is not enough to exclude it from automatic pausing. Typically a few user requests to the database each day over the previous week is enough to keep the project from being paused."

The same text is present in the docs source of truth, [`apps/docs/content/guides/platform/free-project-pausing.mdx`](https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/free-project-pausing.mdx) (accessed 2026-10-03), so it is not a rendering artefact.

**Verdict on the runbook's claim.** `docs/supabase-backup-restore.md` §7 currently reads:

> "The free-tier project pauses after **7 days of inactivity**."

The number 7 is right for the Free plan. **The framing is wrong, and the framing is the operationally dangerous part.** "7 days of inactivity" reads as an idle timer that resets on any touch. The documented behaviour is a *query-volume heuristic evaluated over a rolling 7-day window*. Supabase explicitly warns that being visibly active is not sufficient:

> "While you may be actively using the project, it's possible that usage is not enough to exclude it from automatic pausing."

An operator who reads "7 days of inactivity" will conclude that opening the dashboard once a week is enough. It may not be.

### 1.2 Plan-by-plan table

The authoritative plan-by-plan statement is the feature comparison on [`supabase.com/pricing`](https://supabase.com/pricing) (accessed 2026-10-03), row **Pausing**:

| Feature | Free | Pro | Team | Enterprise |
| ------- | ---- | --- | ---- | ---------- |
| Pausing | After 1 week of inactivity | Never | Never | Never |

Same page, verbatim, in two other places:

> "Free projects are paused after 1 week of inactivity. Limit of 2 active projects."

> "Projects on paid plans aren't paused for inactivity."

So: **the 7-day / 1-week window is Free-only.** There is no Pro, Team, or Enterprise variant to cite, because those plans are never paused for inactivity. The runbook's unqualified "The free-tier project pauses after 7 days" is correct only because the runbook is explicitly scoped to a free-tier project — but the scoping should be made explicit rather than implied.

The docs also state the plan is an **organization-level** property, not a per-project one:

> "Different plans cannot be mixed within a single organization. For example, you cannot have both a Pro Plan project and a Free Plan project in the same organization."
> — [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase), accessed 2026-10-03

### 1.3 Notification, not a hard timer

> "Supabase sends two emails to the project owner regarding project pausing:
>
> 1. A warning email roughly one week before the pause takes effect.
> 2. A confirmation email once the project has been paused."
> — [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing), accessed 2026-10-03

Operationally this is the best available early warning: a project can be resumed in the warning window and the pause is then avoided entirely.

---

## 2. What resets the inactivity clock

### 2.1 What Supabase documents

Two actions are listed, verbatim, as things that prevent a pause **after the warning email**:

> "After receiving an initial email warning, the pause can be prevented by taking one of the following steps:
>
> - Visit the project from the [Supabase Dashboard](https://supabase.com/dashboard/project/_) to generate activity.
> - Generate a sufficient amount of activity by making API calls to your project or sending requests via your connected application."
> — [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing), accessed 2026-10-03

### 2.2 What is NOT documented

**UNVERIFIED: the precise definition of the activity counter.** I searched the free-plan pausing guide, the production checklist, the billing guide, the plan-limits/quotas table, the backups guide, the database-size guide, and the Management API OpenAPI spec. **No Supabase document defines what increments the inactivity counter**, states a numeric threshold, or states whether the window is rolling or fixed.

Specifically UNVERIFIED, because Supabase does not publish it:

- the exact number of queries per day that constitutes "a few user requests";
- whether the window is rolling-7-day or a fixed week boundary;
- whether Auth, Storage, Edge Function, or Realtime calls **without** a database query count as activity.

### 2.3 A precision trap in the wording

Note the mismatch between the two bullet points. The first says "Visit the project from the Supabase Dashboard to **generate activity**". The second says "making **API calls** to your project". But the definition of inactivity is narrower than both:

> "A Free plan project is considered inactive if it does not receive sufficient **user database activity** over the past week. Projects with too few **user queries** during that window..."
> — [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing), accessed 2026-10-03

The threshold is defined over **database queries**. A runbook instruction of the shape "just hit the API daily" is therefore not guaranteed to satisfy the documented criterion, because the documented criterion is counted in database queries. The conservative reading — and the one the runbook should adopt — is that **the cheapest reliable keep-alive is a real query against the database**, which trivially satisfies every candidate definition.

**Recommendation for the runbook:** do not describe the mechanism. Describe a keep-alive that is unambiguously sufficient under every documented definition — a trivial authenticated `SELECT 1` against the project's own database, once per day. That is guaranteed to register as database activity regardless of how the undocumented counter is actually implemented.

---

## 3. Detecting a paused project

### 3.1 Authoritative signal: the Management API `status` field — and it is `INACTIVE`, not `PAUSED`

This is the finding most likely to mislead an operator. The project object's `status` field is the one documented machine-readable paused-state signal, and its enumeration is defined in the first-party OpenAPI specification at [`https://api.supabase.com/api/v1-json`](https://api.supabase.com/api/v1-json) (accessed 2026-10-03), schema `V1ProjectResponse_Output` and `V1ProjectWithDatabaseResponse_Output`. Verbatim from the spec:

```json
"status": {
  "type": "string",
  "enum": [
    "INACTIVE",
    "ACTIVE_HEALTHY",
    "ACTIVE_UNHEALTHY",
    "COMING_UP",
    "UNKNOWN",
    "GOING_DOWN",
    "INIT_FAILED",
    "REMOVED",
    "RESTORING",
    "UPGRADING",
    "PAUSING",
    "RESTORE_FAILED",
    "RESTARTING",
    "PAUSE_FAILED",
    "RESIZING"
  ]
}
```

**There is no `PAUSED` value in this enum.** A paused project reports **`INACTIVE`**. An operator grepping for `PAUSED` in the API response finds only `PAUSING` (the transient in-flight pause state) and will draw the wrong conclusion.

Full detection logic, all from the same enum:

| Observed `status` | Meaning |
| ----------------- | ------- |
| `INACTIVE` | **Paused.** This is the paused state. |
| `PAUSING` | Pause in progress — not yet paused. |
| `PAUSE_FAILED` | Pause attempted and failed. |
| `RESTORING` | Resume/restore in progress. |
| `RESTORE_FAILED` | Resume/restore attempted and failed. |
| `ACTIVE_HEALTHY` | Running normally. |
| `ACTIVE_UNHEALTHY` | Running but degraded — a separate problem, not a pause. |

Note the enum deliberately contains both a pause path (`PAUSING`, `PAUSE_FAILED`) and a restore path (`RESTORING`, `RESTORE_FAILED`) but only a single terminal paused value. This is consistent with pause being modelled as the project simply being inactive.

Query it with:

```bash
curl "https://api.supabase.com/v1/projects/$PROJECT_REF" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

`GET /v1/projects/{ref}` requires OAuth scope `projects:read` and fine-grained permission `project_admin_read` (from the same spec, operation `v1-get-project`).

### 3.2 `supabase projects list` does NOT show paused state in its default output

The runbook §7 currently proposes:

> "Open the dashboard, or run `supabase projects list`. A paused project does not appear as an error in code, it just refuses connections."

**The `supabase projects list` half of that instruction does not work as written.** The default human-readable table has no status column. From the CLI source, [`apps/cli/src/commands/projects/projects.format.ts`](https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/projects/projects.format.ts) (branch `develop`, accessed 2026-10-03), verbatim:

```ts
const LIST_HEADERS = [
  "LINKED",
  "ORG ID",
  "REFERENCE ID",
  "NAME",
  "REGION",
  "CREATED AT (UTC)",
] as const;
```

and the row builder uses only `organization_slug`, `id`, `name`, `region`, `created_at`. **A paused project renders identically to a healthy one.** An operator running this command to "confirm the project has not paused" will get a confident, wrong answer.

The JSON output does carry it, however. From [`apps/cli/src/commands/projects/list/list.handler.ts`](https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/projects/list/list.handler.ts) (accessed 2026-10-03), the machine-readable path projects each raw object through untouched:

```ts
const projects: ReadonlyArray<LinkedProject> = parsed.map((project) => ({
  ...(typeof project === "object" && project !== null ? project : {}),
  linked: ...
}));
```

and `status` is a declared field of the encoded struct:

```ts
["status", goString],
```

So the working CLI detection command is:

```bash
supabase projects list -o json | jq -r '.[] | select(.id=="'"$PROJECT_REF"'") | .status'
```

Expect `INACTIVE` when paused.

**CLI documentation inconsistency worth noting:** the documented global flag is `-o, --output <[ env | pretty | json | toml | yaml ]>` ([CLI Reference](https://supabase.com/docs/reference/cli/supabase-projects-list), accessed 2026-10-03), but the `supabase projects list` example on the same page shows `--output-format json`. The handler reads `OutputFlag` for the Go encoders (`json`/`yaml`/`toml`) and separately reads `output.format` for a different JSON path. Prefer `-o json`, which is the documented global form.

### 3.3 Dashboard

The dashboard presents the paused project and a **Resume project** control (see §4.1 for the verbatim path). Project status strings rendered in the dashboard UI are not documented in any Supabase documentation page.

UNVERIFIED: the exact dashboard status label for a paused project. **What I tried:** searched the Supabase docs, the changelog, and the docs source repository (`apps/docs/content/`) for a paused-state UI string; the docs content for platform guides contains `free-project-pausing.mdx`, which does not quote any dashboard string. The most commonly reported dashboard copy, "All of your project's data is still intact, but your project is inaccessible while paused", appears only in community threads and is **not** treated as an official string here.

### 3.4 Database connection error text — the biggest gap, and a real misdiagnosis risk

**UNVERIFIED: the connection error text returned by a paused Supabase project.**

**What I tried:** searched Supabase docs and troubleshooting guides for the paused-project connection failure. Supabase publishes a troubleshooting page titled [`Error: "Connection refused" when trying to connect to Supabase database`](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr) (accessed 2026-10-03) which quotes these exact strings:

> - `connect ECONNREFUSED 1.2.3.4:5432`
> - `psql: error: connection to server at "db.xxxxxxxxxxxxxxxxxxxx.supabase.co" (1.2.3.4), port 5432 failed: Connection refused Is the server running on that host and accepting TCP/IP connections?`
> - `Circuit breaker open: Unable to establish connection to upstream database`

**These are attributed to a different cause and must not be quoted as the paused-project signature.** That page attributes them to banned IPs:

> "this could be because there are banned IPs on your project caused by Fail2ban as it kicks in when attempting 2 wrong passwords in a row."

**This is a live operational hazard for this runbook.** A paused project presents as a refused database connection, and the only officially documented Supabase page explaining a refused database connection points at Fail2ban IP bans — which have a completely different remedy (`supabase network-bans remove`, and bans "clear after 30mins"). An operator following that page will chase a nonexistent IP ban while the project is actually paused and unrecoverable until resumed.

Two Supabase-documented strings that are **not** the pause signal but will appear in the same incident, and should be checked to avoid misattribution:

- **Read-only mode** (a size limit, not a pause), verbatim from [Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size) (accessed 2026-10-03): "In read-only mode, clients will encounter errors such as `cannot execute INSERT in a read-only transaction`. The Postgres SQLSTATE code for this error is **25006** (`read_only_sql_transaction`). During severe disk exhaustion, **SQLSTATE 53100** (`disk_full`) may also appear."
- **Fair Use restriction**, same page: "your organization can be placed under a [Fair Use](...) service restriction (requests return a `402` status code) when its database size exceeds the plan quota."

Neither of these means "paused". Both mean the project is *running*.

**Consequence for the runbook:** detection must be driven by the Management API `status` field, not by observed connection failures. A refused connection is not a diagnosis; it is a symptom with at least three documented causes.

### 3.5 There is no CLI pause/unpause command to detect or fix this with

See §4.2.

---

## 4. How to unpause / restore

### 4.1 Dashboard — supported, and the primary documented path

Verbatim from [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing) (accessed 2026-10-03):

> "You can restore a paused project for up to 1 year after it was paused:
>
> 1. Open the [Supabase Dashboard](https://supabase.com/dashboard/organizations)
> 2. Select the organization, followed by the paused project
> 3. Click **Resume project** and confirm
>
> The project will return to its previous state, including data and configurations."

Path, condensed: **Dashboard → organization → paused project → "Resume project" → confirm.**

The inverse (manual pause) is documented on the delete-project page, verbatim ([Deleting Your Project](https://supabase.com/docs/guides/platform/delete-project), accessed 2026-10-03):

> "To pause a project, navigate to **Settings > General > Project availability** and click **Pause Project**."

and, on the same page:

> "Note: Note: Only Free Projects can be paused at this time.
>
> - **Paused projects** stop incurring compute charges
> - **Data is preserved** and can be accessed when you resume
> - **Quick recovery** — Resume the project at any time without data loss"

Note that the *pause* control lives under Settings > General > Project availability, while the *resume* control is on the project's overview/organization surface. They are not in the same place, which is worth stating in the runbook.

### 4.2 CLI — **does not exist for projects**

**There is no `supabase projects pause` and no `supabase projects unpause` / `restore`.** This was verified two independent ways.

**From the official CLI Reference** ([supabase.com/docs/reference/cli](https://supabase.com/docs/reference/cli/supabase-projects-list), accessed 2026-10-03), the `Projects` command group lists exactly four subcommands:

> - [Manage projects](/docs/reference/cli/supabase-projects)
> - [Create a project](/docs/reference/cli/supabase-projects-create)
> - [List all projects](/docs/reference/cli/supabase-projects-list)
> - [Show API keys for a project](/docs/reference/cli/supabase-projects-api-keys)
> - [Delete a project](/docs/reference/cli/supabase-projects-delete)

No pause. No resume.

**From the first-party CLI source tree**, [`supabase/cli`](https://github.com/supabase/cli) default branch `develop`, directory `apps/cli/src/commands/projects/` (accessed 2026-10-03), contains only:

```
apps/cli/src/commands/projects/api-keys/
apps/cli/src/commands/projects/create/
apps/cli/src/commands/projects/delete/
apps/cli/src/commands/projects/list/
apps/cli/src/commands/projects/projects.command.ts
apps/cli/src/commands/projects/projects.errors.ts
apps/cli/src/commands/projects/projects.format.ts
apps/cli/src/commands/projects/projects.prompt.ts
```

**Do not confuse this with the branch commands.** `supabase branches pause` and `supabase branches unpause` **do** exist in the CLI (same reference page, "Branches" group; `Usage: supabase branches unpause [name]`). They operate on **preview branches**, not on projects, and will not resume a paused project. Branch auto-pause is a separate mechanism with its own behaviour — verbatim, from [Branching troubleshooting](https://supabase.com/docs/guides/deployment/branching/troubleshooting) (accessed 2026-10-03): "Auto-pause: The branch might be paused. It will resume on the first request. Preview branches auto-pause after inactivity."

Note that branch resume is **on-demand on first request**, whereas project resume is an explicit administrative action. Do not generalize one to the other.

### 4.3 Management API — supported, and this is the path that closes the gap

A restore endpoint **does** exist. Verbatim from the official API reference, [Restore a project](https://supabase.com/docs/reference/api/v1-restore-a-project) (accessed 2026-10-03):

> "Restores the given project
>
> ```
> post /v1/projects/{ref}/restore
> ```
>
> **OAuth scopes**
>
> - `projects:write`
>
> **The fine-grained token must include the following permissions to access this endpoint:**
>
> - `project_admin_write`
>
> **Path parameters**
>
> - `ref` — Required — string — Project ref
>
> **Response codes**
>
> - 200
> - 401
> - 403
> - 429"

Confirmed independently against the first-party OpenAPI spec (accessed 2026-10-03), which additionally exposes the endpoint owners and the security scheme:

```json
"operationId": "v1-restore-a-project",
"summary": "Restores the given project",
"security": [ { "bearer": [] } ],
"x-oauth-scope": "projects:write",
"x-fga-permissions": [ [ "project_admin_write" ] ],
"x-endpoint-owners": [ "control-plane", "infra" ],
"responses": {
  "200": { "description": "" },
  "401": { "description": "Unauthorized" },
  "403": { "description": "Forbidden action" },
  "429": { "description": "Rate limit exceeded" }
}
```

Runnable form:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/restore" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Required auth: a **bearer** token. Either a personal access token from `https://supabase.com/dashboard/account/tokens` (as used in Supabase's own [backups guide](https://supabase.com/docs/guides/platform/backups), accessed 2026-10-03), or an OAuth token carrying `projects:write`. For a fine-grained PAT, `project_admin_write` is required.

The 200 response has **an empty body** (`"description": ""`; the rendered reference shows the schema as `{}`). **Do not parse the restore response for a status field — there isn't one.** Poll `GET /v1/projects/{ref}` and watch for `RESTORING` → `ACTIVE_HEALTHY`.

**Related restore-family endpoints**, all confirmed present in the spec (accessed 2026-10-03):

| Method | Path | Summary | Scope |
| ------ | ---- | ------- | ----- |
| `GET` | `/v1/projects/{ref}/restore` | "Lists available restore versions for the given project" | `projects:read` |
| `POST` | `/v1/projects/{ref}/restore` | "Restores the given project" | `projects:write` |
| `POST` | `/v1/projects/{ref}/restore/cancel` | Cancel a project restoration | — |
| `POST` | `/v1/projects/{ref}/pause` | "Pauses the given project" | `projects:write` |
| `POST` | `/v1/projects/{ref}/restart` | "Restarts a project" | `projects:write` |

Two cautions:

- `POST /v1/projects/{ref}/restart` exists alongside `/restore`, and its documentation is a single word. **UNVERIFIED: whether `/restart` resumes a paused project.** The spec does not say, and the docs do not mention it. Do not substitute it for `/restore` on the assumption they are equivalent; use `/restore`, which is the endpoint the pausing documentation's semantics belong to.
- `GET /v1/projects/{ref}/restore` is named "restore versions", i.e. it enumerates restorable platform versions, not backups. It is a pre-flight check, not a substitute for `GET /v1/projects/{ref}`.

### 4.4 Summary of supported recovery paths

| Path | Exists? | Evidence |
| ---- | ------- | -------- |
| Dashboard "Resume project" | **Yes** | `free-project-pausing`, quoted above |
| Management API `POST /v1/projects/{ref}/restore` | **Yes** | Official API reference + OpenAPI spec, quoted above |
| CLI `supabase projects unpause` | **No** | Absent from CLI reference and from `apps/cli/src/commands/projects/` |
| `supabase branches unpause` | Exists, but **wrong object** — preview branches only | CLI reference, Branches group |

---

## 5. How long does recovery take

### 5.1 The runbook's claim does not survive verification

`docs/supabase-backup-restore.md` §7 currently asserts:

> "Unpausing takes on the order of minutes and needs no intervention once triggered."

**UNVERIFIED: the duration of a project resume.** **What I tried:** read the complete `free-project-pausing` guide (the page that owns this behaviour) in both its rendered and source form; searched the Supabase changelog; searched the Management API OpenAPI spec for timing, SLA, or duration metadata on `v1-restore-a-project`; checked the pricing page and the backups guide.

**Findings:**

- The pausing guide states **no duration at all**. It describes the trigger, the restore window, and the restore procedure, and says: "The project will return to its previous state, including data and configurations." Nothing about how long that takes.
- The OpenAPI spec declares no timing or SLA for `v1-restore-a-project`.
- Neither "minutes" nor any other figure appears in any official source.

**Therefore the runbook's "on the order of minutes" is an unsourced assertion and must not be presented as a Supabase guarantee.**

### 5.2 The only adjacent official statement is about a different operation

Supabase does document restore duration for **PITR**, and deliberately declines to give a number. Verbatim from [How long does it take to restore a database from a Point-in-Time backup (PITR)?](https://supabase.com/docs/guides/troubleshooting/how-long-does-it-take-to-restore-a-database-from-a-point-in-time-backup-pitr-qO8gOG) (accessed 2026-10-03):

> "The time required for a PIT restoration isn't fixed. It depends on several factors:
>
> **Time Since Last Full Backup:** Full backups occur weekly. The time elapsed since the last full backup can affect restoration time.
>
> **Write-Ahead Logging (WAL) Activity:** The volume of WAL activity since the last full backup is a critical factor. More activity can lead to longer restoration times.
>
> **Database Size:** While important, the size of the database isn't the sole determinant of restoration time."

This is PITR, **not** resume-from-pause, and it is cited here only to show that Supabase's documented posture on restore timing is "not fixed, depends on factors" — it does not support a numeric figure.

For **backup restores** (also a different operation) the docs say, verbatim from [Database Backups](https://supabase.com/docs/guides/platform/backups) (accessed 2026-10-03):

> "The project is inaccessible during this process, so plan for downtime beforehand. Downtime depends on the size of the database—the larger it is, the longer the downtime will be."

### 5.3 Is it synchronous or queued?

**The status enum establishes that resume is asynchronous and observable.** `RESTORING` and `RESTORE_FAILED` are distinct, documented, terminal-or-transient values in the project `status` enum (§3.1). A synchronous operation would need no such states. The correct model is therefore: **the restore request returns 200 immediately with an empty body, and the project transitions to `ACTIVE_HEALTHY` asynchronously.** That is an inference from the published enum, and is stated as such.

UNVERIFIED: whether any progress percentage or ETA is exposed anywhere. No such field was found in the spec.

**Recommendation for the runbook:** delete "on the order of minutes" and replace it with a measured, polled procedure. Poll `GET /v1/projects/{ref}` until `status` leaves `RESTORING`, and time that loop on the actual project during a controlled drill. The whole point of this runbook is that its numbers are observed output, not estimates — an unsourced estimate is worse than a blank.

---

## 6. Does pausing affect backups or restores

### 6.1 Free projects have no scheduled backups at all

From the pricing feature comparison ([supabase.com/pricing](https://supabase.com/pricing), accessed 2026-10-03):

| Feature | Free | Pro | Team | Enterprise |
| ------- | ---- | --- | ---- | ---------- |
| Automatic backups | Not included | 7 days | 14 days | Custom |
| Point in time recovery | Not included | $100/month per 7 days retention | $100/month per 7 days retention | $100/month per 7 days retention |

And verbatim from the production checklist ([going-into-prod](https://supabase.com/docs/guides/platform/going-into-prod), accessed 2026-10-03):

> "Database backups are not available for download on the Free Plan.
>
> - Read [the Database Backups guide](https://supabase.com/docs/guides/platform/backups) for more options and retention details."

And from the backups guide (accessed 2026-10-03):

> "We automatically back up all Pro, Team, and Enterprise Plan projects on a daily basis."

**So for this free-tier project there is no Supabase-managed backup cadence to be disrupted by pausing. That question is largely moot for the plan in question** — which is itself an argument for the runbook's existing position that `pg_dump` is the only backup that matters here.

### 6.2 A pre-pause logical backup does exist and is served while paused

Despite the "not available for download" line above, Supabase documents a **snapshot taken at pause time**, available from the paused project.

Verbatim from the changelog policy entry [Paused Free Plan projects are restorable for 90 days](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) (published 2024-06-24, accessed 2026-10-03):

> "once a project is no longer restorable, the 'restore' option is replaced with an option to download the latest logical backup, **taken right before the project is paused**, and all Storage objects"

And verbatim from [How To Restore a Project Paused for More Than 1 Year](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause) (accessed 2026-10-03):

> "Both the database backup and Storage objects can be downloaded from the [Project Overview](https://supabase.com/dashboard/project/_) section in Supabase Studio before the project is deleted."

> "In the Project Overview of your paused project, download:
>
> - **Database backup** — the `.backup` file from the Backups section
> - **Storage objects** — all files from your Storage buckets"

**Answer to "does a paused project still serve its backups": yes.** While paused, the Project Overview of the paused project serves the logical database backup taken immediately before the pause, plus Storage objects. That is the last point-in-time snapshot Supabase takes for a Free project.

### 6.3 Flagged contradiction

**`going-into-prod` says Free-plan backups are "not available for download". `restore-project-after-90-days-pause` instructs you to download a `.backup` file from a paused Free project.** Both are current Supabase documentation. The reconciliation is most likely that the routine downloadable-backups feature is Pro-and-up, while the *pause snapshot* is a separate artifact exposed only on a paused project — but Supabase does not state that reconciliation anywhere. Flagged, not resolved.

The practical consequence for this runbook is that §7's advice to take backups 48h and 24h before the presentation is **more** important, not less: the Supabase-side artifact is a single snapshot from an unknown time in the past, whereas the runbook's own `pg_dump` artifacts are timestamped and stored off the presentation machine.

### 6.4 Can you restore *into* a paused project?

**UNVERIFIED.** **What I tried:** the pausing guide, the backups guide, the restore-project-after-pause guide, the Management API OpenAPI spec (including the `/database/backups/restore`, `/restore-pitr`, and `/restore-point` paths and their response codes).

No Supabase document states whether a restore can target a project in `INACTIVE`. Every documented flow that results in a *working* project targets either a resumed project or a **new** project — the >1-year guide's whole procedure is "create a new project, then restore into it".

**Do not assume a paused project can accept a restore.** The safe sequence is: resume first (`POST /v1/projects/{ref}/restore`), confirm `ACTIVE_HEALTHY`, then restore. This costs one API call and removes the question.

One relevant constraint on restores generally, verbatim from the backups guide (accessed 2026-10-03):

> "If your project uses subscriptions or replication slots, you need to drop them before the restoration and re-create them afterwards. We exempt the slot used by Realtime from this requirement and handle it automatically."

And, on backup contents, from the same page:

> "Database backups do not include objects you store via the Storage API, as the database only includes metadata about these objects. Restoring an old backup does not restore objects you deleted after that backup."

---

## 7. Free-tier limits relevant to a demo/presenting project

All from [supabase.com/pricing](https://supabase.com/pricing) and [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) (both accessed 2026-10-03) unless noted.

### 7.1 The caps

| Limit | Free-plan value | Source |
| ----- | --------------- | ------ |
| Projects | **2 active free projects**; "Paused projects do not count towards your free project limit." | billing guide |
| Project-count scope | "The project limit applies across all organizations where you are an Owner or Administrator." | billing guide |
| Database size | **500 MB per project** | pricing feature table |
| Disk size | **1 GB** included | pricing feature table |
| Storage | **1 GB included** | pricing feature table |
| Max file upload size | **50 MB** | pricing feature table |
| Egress | **5 GB** included (plus 5 GB cached egress) | pricing feature table |
| Edge Function invocations | **500,000** per month | pricing feature table |
| Realtime peak connections | **200** | pricing feature table |
| MAUs | **50,000** | pricing feature table |
| Automatic backups | **Not included** | pricing feature table |
| PITR | **Not included** | pricing feature table |
| Branching | **Not included** | pricing feature table |
| Log retention | **1 day** | pricing feature table |
| Pausing | **After 1 week of inactivity** | pricing feature table |
| Support | Community only | pricing feature table |

Verbatim on the project count:

> "The Free Plan helps you get started and explore the platform. You are granted two free projects. The project limit applies across all organizations where you are an Owner or Administrator. This means you could have two Free Plan organizations with one project each, or one Free Plan organization with two projects. Paused projects do not count towards your free project limit."

Verbatim from the pricing FAQ, on the two-project cap:

> "You are entitled to two active free projects. Paused projects do not count towards your quota. Note that within an organization, we count the free project limits from all members that are either Owner or Admin."
> — [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq), accessed 2026-10-03

### 7.2 The 500 MB cap is a read-only trigger, not a hard delete

This is the non-obvious limit for a presenting project. Verbatim from [Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size) (accessed 2026-10-03):

> "Free Plan projects enter [read-only](#read-only-mode) mode when your **database size** exceeds 500 MB. Note that this is the *database size* limit (the size of your actual Postgres data), not the *disk size*. Free Plan projects include 1 GB of disk space, but read-only mode is triggered by the 500 MB database size quota."

For scale, the same page notes: "New Supabase projects have a database size of ~40-60mb."

So the failure mode at 500 MB is **read-only**, error `25006 read_only_sql_transaction` — **not** a pause, and **not** data loss. This must be distinguishable from pausing in the runbook, because the two look similar from the outside (the app is broken) but have opposite remedies: pausing needs `POST .../restore`, read-only needs a `VACUUM` or a plan upgrade.

A second, separate restriction on the same page, which is *not* read-only and *is* plan-wide:

> "your organization can be placed under a [Fair Use](...) service restriction (requests return a `402` status code) when its database size exceeds the plan quota. This quota is evaluated **per organization**, summing the database size across all of your projects. Importantly, it is based on the **average daily database size over the billing period**, not the live size."

### 7.3 Pause duration cap — this is a restore window, not a plan limit

There is no "maximum pause duration" in the plan limits. What exists is a **restore window**, and Supabase's own sources contradict each other on its length. See §8.

---

## 8. Flagged contradiction: the restore window is 90 days or 1 year, depending on which page you read

This is a genuine inconsistency inside Supabase's current documentation, not a paraphrase problem.

**Source A — the pausing guide, current text.** From [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing) and its source [`free-project-pausing.mdx`](https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/free-project-pausing.mdx) (both accessed 2026-10-03):

> "You can restore a paused project for up to **1 year** after it was paused"

> "Once the project is paused, there is a **1-year** window to restore the project on the platform from within Supabase Studio."

**Source B — the same page, residual 90-day artefacts.** On that identical page, the subheading is:

> "### Restore window \[#90-day-window-to-restore]"

The anchor is explicitly pinned to `#90-day-window-to-restore`. The body text says 1 year; the heading it is attached to says 90 days.

**Source C — the >1-year troubleshooting page.** From [restore-project-after-90-days-pause](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause) (accessed 2026-10-03), the rendered title is:

> "How To Restore a Project Paused for More Than 1 Year"

> "Projects paused for more than **1 year** can no longer be restored through Supabase Studio."

while the page's own URL slug is `restore-project-after-90-days-pause` and its hero image is `/docs/img/restore-after-90-day-dark.png`.

**Source D — the older changelog policy, which is where 90 days comes from.** From [27497](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) (published 2024-06-24, accessed 2026-10-03), verbatim:

> "Beginning June 24, 2024, we're updating some project pause/restore behavior:
>
> - paused Free projects are restorable for **90 days** following their pause date
> - any Free projects paused before June 24 will be able to restore at any point before September 22, 2024 so they have a full 90 days from when this announcement is made
> - once a project is no longer restorable, the 'restore' option is replaced with an option to download the latest logical backup, taken right before the project is paused, and all Storage objects
>
> Previously, paused projects could be restored indefinitely."

**Assessment.** The prose across the live guides is consistently **1 year**. The 90-day figures survive only as un-updated slugs, anchor IDs, and image filenames, plus the 2024 changelog entry, which is a dated historical policy notice and was superseded at some point without a corresponding changelog entry announcing the change to 1 year.

**I could not find a changelog entry announcing the extension from 90 days to 1 year.** The 2024 policy entry is the only changelog record of the window, and it says 90 days.

**What this means operationally, and why it matters for the runbook:** the *current documented* window is 1 year, but a project sitting near 90 days could plausibly be past the window if the 2024 policy is what the platform actually enforces. **The runbook must not depend on the difference.** Practically, the entire reason this runbook takes `pg_dump` archives off the presentation machine is that the platform-side restore window is (a) not guaranteed by a single consistent source and (b) far too long to be useful for a presentation anyway. A project paused the week before a demo is not a data-loss event; a project left paused for a term is. The `pg_dump` discipline already handles it.

---

## 9. Verdict on the runbook's existing claims

| Runbook claim (`docs/supabase-backup-restore.md`) | Verdict |
| ------------------------------------------------ | ------- |
| §7: "The free-tier project pauses after **7 days of inactivity**." | **Number correct, framing wrong.** 7 days is the Free-plan window and is Free-only. But it is a query-volume threshold over a 7-day window, not an idle timer, and Supabase explicitly warns that visible activity may not be enough. Must be rewritten. |
| §7: "Unpausing takes **on the order of minutes** and needs no intervention once triggered." | **UNVERIFIED — no official source.** Supabase publishes no duration for resume. Delete the number; poll `status` instead and measure. |
| §7: "A paused project does not appear as an error in code, it just refuses connections." | **Half right, and the half that is wrong is dangerous.** A refused connection is the correct symptom, but it is not a diagnosis — three distinct documented causes produce it. Detection must use the Management API `status` field. |
| §7: "run `supabase projects list`" to confirm the project has not paused. | **Does not work as written.** The default table has no status column and renders paused and healthy projects identically. Use `-o json` and read `.status`. |
| §7 (implicit): no recovery procedure is given. | **Gap confirmed and now closed.** Dashboard and `POST /v1/projects/{ref}/restore` both work. The CLI has no equivalent. |

### 9.1 Concrete corrections to apply

1. **Rewrite the pause trigger** as a rolling-window query-volume heuristic, quoting §1.1, and state that the number is Free-plan-only.
2. **Delete "on the order of minutes."** Replace with: POST restore, then poll `GET /v1/projects/{ref}` until `status` is `ACTIVE_HEALTHY`.
3. **Add the recovery procedure** with both the dashboard path and the exact `curl` for `POST /v1/projects/{ref}/restore`, including the required `projects:write` / `project_admin_write` auth.
4. **Replace the detection step** with a `status` check, and record that paused = **`INACTIVE`**, not `PAUSED`.
5. **Fix the detection command** to `supabase projects list -o json`, and note that `supabase branches unpause` is unrelated.
6. **Add the misdiagnosis warning**: a refused database connection is documented under Fail2ban IP bans on Supabase's own troubleshooting page, and read-only mode (`25006`) is a distinct condition with a distinct remedy.
7. **Note the restore-window contradiction** rather than picking a number, and keep the `pg_dump` discipline as the real guarantee.
8. **Add the 500 MB read-only trigger** as a distinct failure mode from pausing.

---

## 10. Source inventory

All accessed **2026-10-03**.

### Official documentation

| Source | URL | Used for |
| ------ | --- | -------- |
| Project Pausing (canonical) | https://supabase.com/docs/guides/platform/free-project-pausing | 7-day window, activity definition, restore procedure, 1-year window |
| Project Pausing — docs source of truth | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/free-project-pausing.mdx | Confirms rendered text; exposes the `90-day` anchor |
| Production Checklist | https://supabase.com/docs/guides/platform/going-into-prod | "7-day period", "restore paused projects from the Supabase dashboard", Free backups not downloadable |
| About billing on Supabase | https://supabase.com/docs/guides/platform/billing-on-supabase | 2-project cap, paused projects excluded, per-plan quota table |
| Billing FAQ | https://supabase.com/docs/guides/platform/billing-faq | "two active free projects", Owner/Admin aggregation |
| Pricing | https://supabase.com/pricing | Plan-by-plan Pausing row, caps, backups, storage, egress |
| Database Backups | https://supabase.com/docs/guides/platform/backups | Backup availability by plan, restore downtime is size-dependent, subscription/slot constraint, Storage not in backups |
| Understanding Database and Disk Size | https://supabase.com/docs/guides/platform/database-size | 500 MB read-only trigger, `25006`, `53100`, Fair Use `402` |
| Deleting Your Project | https://supabase.com/docs/guides/platform/delete-project | Manual pause path (Settings > General > Project availability), "Only Free Projects can be paused" |
| Restore a project — Troubleshooting | https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause | >1-year title vs. 90-day slug; downloading `.backup` + Storage from a paused project |
| Pausing Pro-Projects | https://supabase.com/docs/guides/troubleshooting/pausing-pro-projects-vNL-2a | Paid projects cannot be paused; transfer-to-free-org route |
| PITR restore duration | https://supabase.com/docs/guides/troubleshooting/how-long-does-it-take-to-restore-a-database-from-a-point-in-time-backup-pitr-qO8gOG | "isn't fixed", factors |
| "Connection refused" | https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr | Exact refused-connection strings, attributed to Fail2ban |
| Branching troubleshooting | https://supabase.com/docs/guides/deployment/branching/troubleshooting | Branch auto-pause "resume on the first request" (contrast with projects) |
| Changelog 27497 (2024-06-24) | https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days | The 90-day policy; pre-pause logical backup artifact |

### First-party API reference

| Source | URL | Used for |
| ------ | --- | -------- |
| Restore a project | https://supabase.com/docs/reference/api/v1-restore-a-project | `POST /v1/projects/{ref}/restore`, scopes, response codes |
| Pause a project | https://supabase.com/docs/reference/api/v1-pause-a-project | `POST /v1/projects/{ref}/pause` |
| Management API OpenAPI spec | https://api.supabase.com/api/v1-json | `status` enum (incl. `INACTIVE`), bearer security, `x-oauth-scope`, `x-fga-permissions`, endpoint inventory, services-health path |

### First-party CLI source / docs

| Source | URL | Used for |
| ------ | --- | -------- |
| CLI Reference | https://supabase.com/docs/reference/cli/supabase-projects-list | `supabase projects` subcommands (no pause/unpause); `supabase branches unpause` |
| `supabase/cli` — `projects.format.ts` | https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/projects/projects.format.ts | `LIST_HEADERS` — proves no status column |
| `supabase/cli` — `list.handler.ts` | https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/projects/list/list.handler.ts | `-o json` passes raw objects through; `["status", goString]` |
| `supabase/cli` — `list.command.ts` | https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/projects/list/list.command.ts | `--output-format json` example (doc inconsistency) |
| `supabase/cli` repo tree (`develop`) | https://github.com/supabase/cli | `apps/cli/src/commands/projects/` contains only api-keys, create, delete, list |

### Explicitly NOT used as evidence

Community GitHub discussions, third-party blog posts, and vendor/agency write-ups surfaced during searching (including at least one asserting a "two to five minutes" resume time). These are excluded under the primary-source constraint. None of them contributed a fact to this document. The absence of an official resume-duration figure is therefore reported as `UNVERIFIED` rather than filled in from the third-party figure that was found.

---

## 11. Open items for the runbook author

These cannot be resolved from documentation and require an actual drill against the project:

1. **Measure the resume duration.** Pause the project manually (Settings > General > Project availability), then time `POST /v1/projects/{ref}/restore` → `ACTIVE_HEALTHY`. This is the only way to replace the unsourced "order of minutes" with a number this repo can defend.
2. **Capture the actual paused-project connection error.** Deliberately attempt a connection while paused and record the verbatim string and HTTP status. This closes the §3.4 gap with observed output rather than guesswork, and lets the runbook distinguish pause from Fail2ban and from read-only mode.
3. **Confirm the restore window empirically** if convenient — the docs contradict themselves (§8), and the UI is the arbiter.

Do not resolve any of these by inferring from platform behaviour. Inferring is exactly what produced the false deletion claim noted in this task's brief.