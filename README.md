# Document Review & Approval Workspace

A standalone take-home exercise for the Basalt Forge Systems **Senior Full Stack Workspace Engineer** technical screening. This is **not** a real Basalt Forge product — the company and scenario are the prompt for the exercise.

It implements a small internal **Document Review & Approval Workspace**: normal users submit documents, reviewers approve or reject them, and every status change is preserved in an immutable audit history.

```text
User  →  Submission  →  Review  →  Approval / Rejection  →  Immutable audit history
```

The design goals, in priority order:

- **Make document state easy to understand** — one workspace, clear statuses (Pending / Approved / Rejected), and an activity timeline per document.
- **Support informed reviewer decisions** — reviewers see the full document and its history before acting; rejection requires a written reason.
- **Enforce permissions on the backend** — authorization lives in the service layer, not the UI, and roles are read from the database on every request.
- **Maintain a trustworthy audit trail** — status changes and audit events are written in the same transaction, and audit rows are append-only at the database level.

---

## Features

Only implemented behavior is listed below.

### Normal user capabilities

- **Submit a document** with a title (required), a text body (required), and an optional category.
- **View only their own submissions** — the list is scoped to the caller in the database query, never by client input.
- **See the current status** of each of their submissions (Pending / Approved / Rejected).
- **Open a submission's details**, including the full body.
- **View a submission's audit history**, including the reason when it was rejected.

### Reviewer capabilities

- **View all submissions** across every author.
- **See Pending, Approved, and Rejected states** — the "All" view is a three-column board; a single-status view is a card grid.
- **Search submissions** by keyword (matches the document title or body).
- **Filter submissions** by status, category, author, and date range.
- **Identify what needs attention** — at-a-glance status counts, with the Pending queue ordered oldest-first.
- **Open full submission context** (body + activity timeline) before deciding.
- **Approve a pending submission.**
- **Reject a pending submission with a required reason** (an empty or whitespace-only reason is refused).
- **View the audit history separately** — exposed as its own endpoint (`GET /api/submissions/:id/audit`) and rendered as an activity timeline beside the document.

> Note on where filtering runs: reviewer keyword **search** executes in the database (it needs the body, which the list query otherwise omits). The remaining reviewer filters (status, category, author, date) and all sorting are applied on the client over the returned set. See [Tradeoffs](#tradeoffs).

### Permission and integrity behavior

- **Backend-enforced authorization** — every reviewer action passes through `requireReviewer()` in the service layer before doing any work.
- **Normal users cannot access reviewer-only endpoints** — a `USER` calling a reviewer service receives `403`.
- **Normal users cannot view another user's submission** — a non-owner receives `404`, identical to a genuinely missing record, so existence is never disclosed.
- **Reviewer actions are enforced by backend services**, which both the API route handlers and the server-rendered pages call — there is no UI-only gate.
- **Invalid or repeated decisions return appropriate errors** — deciding a non-pending submission returns `409`; rejecting without a reason returns `400`.
- **Status changes and audit events are committed together** — a decision runs as one `prisma.$transaction`; the status update and the audit event succeed or roll back as a unit.
- **Audit records are append-only** — database triggers block `UPDATE`, `DELETE`, and `TRUNCATE` on the audit table.

---

## Technology Stack

Generated from `package.json`, `docker-compose.yml`, and the project source.

| Area | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router) | `^16.2.12` |
| UI | React | `^19.2.8` |
| Language | TypeScript | `^5.9.0` |
| Runtime | Node.js | `20.9+` (required by Next.js 16) |
| Database | PostgreSQL (`postgres:16-alpine`) | 16 |
| ORM | Prisma — engine-less, via the `pg` driver adapter | `^6.19.0` |
| DB driver | node-postgres (`pg`) | `^8.22.0` |
| Validation | Zod | `^4.4.3` |
| Styling | Tailwind CSS | `^4.3.3` |
| Tests | Vitest | `^4.1.10` |
| Seed runner | tsx | `^4.20.0` |
| Local database | Docker Compose (v2) | — |

The API is served by Next.js **Route Handlers** — there is no separate Express/Node server process. The default `dev`/`build` scripts use `--webpack`; see [Key Design Decisions](#key-design-decisions) for why.

---

## Architecture

Every request — whether it originates from a browser `fetch` or a server-rendered page — flows through the same layers, and authorization is enforced once, in the service layer.

```text
        Next.js UI  (React client + server components)
              │
              ▼
        Route Handlers  (app/api/**/route.ts)
              │
              ▼
   Authentication & Validation  (session cookie, Zod, request hardening)
              │
              ▼
  Authorization & Service Layer  (requireReviewer / ownership; the single authz surface)
              │
              ▼
        Prisma ORM  (engine-less, pg driver adapter)
              │
              ▼
        PostgreSQL  (append-only audit triggers + transition constraints as a backstop)
```

**Why the service layer is the boundary.** Pages are React Server Components that perform a session check purely for *navigation* (redirect to `/login`, send reviewers to their dashboard). They never trust that check for data access — every page loads its data through the same API and service functions a browser would hit, so authorization cannot be bypassed by talking to the API directly.

**Request flow — rejecting a submission** (`POST /api/submissions/:id/reject`):

1. The handler is wrapped by `handle()`, which runs a same-origin check on unsafe methods; the handler then calls `requireUser()`, resolving the user from the signed session cookie → `401` if unauthenticated.
2. `readJson()` guards the body (256 KB cap, NUL-byte and `__proto__` rejection).
3. `rejectSubmission()` calls `requireReviewer()` **before** validating the reason → a `USER` gets `403`, not a `400` about the reason field.
4. The reason is validated (`400` if empty).
5. `decide()` opens one transaction: a conditional `updateMany WHERE status = PENDING` acts as both the state machine and the concurrency guard (`404` if missing, `409` if already decided), then appends the audit event in the same transaction.
6. Database constraints backstop both halves (status-transition trigger; a partial unique index allowing at most one decision per submission).

### Project structure

```text
app/
  api/                      REST API (Route Handlers)
    auth/{login,logout,me}
    submissions/            POST + my + [id] + [id]/audit + [id]/approve + [id]/reject
    reviewer/submissions
  login/                    passwordless sign-in page
  reviewer/, submissions/   role-based pages (Server Component guard → <Workspace/>)
  page.tsx, layout.tsx
components/
  workspace.tsx             the single-screen client UI (list / detail / compose)
  icons.tsx
lib/
  db.ts                     engine-less Prisma client (pg adapter, global singleton)
  auth.ts                   mock login by email; HMAC-signed session; role read from DB
  authz.ts                  requireReviewer (403) / assertCanAccessSubmission (404)
  http.ts                   request hardening + AppError → HTTP status mapping
  validation.ts             Zod input schemas (strictObject, shared by routes + services)
  errors.ts                 typed AppError hierarchy (400/401/403/404/409)
  session.ts                page-render session helpers (navigation only — not the boundary)
  api-client.ts             typed browser API client
  services/                 submission / review / audit services (the authz surface)
prisma/
  schema.prisma
  migrations/               20260802090000_init + 20260802090100_audit_hardening
  seed.ts
tests/
  backend.test.ts           9 service-level tests
  global-setup.ts, test-db.ts
docker-compose.yml          local PostgreSQL 16
```

### Data model & audit integrity

Three tables (`users`, `submissions`, `audit_events`):

- **`submissions`** carry `status` (`PENDING` default), `authorId`, title/body/category, and timestamps. Documents themselves are immutable after creation — the only thing that changes is `status` — which is what makes the audit trail complete.
- **`audit_events`** are the history. Each row records **who** (`actorId` + a snapshot of `actorRole`), **what** (`action`, plus `fromStatus` → `toStatus`), **when** (`createdAt`), and an optional `reason`. A `SUBMITTED` event is written at creation (`null → PENDING`); each decision writes one `APPROVED`/`REJECTED` event (`PENDING → …`).

The `audit_hardening` migration adds database-level guarantees that back up the application logic:

| Guarantee | Mechanism |
| --- | --- |
| Audit rows can't be changed or removed | Triggers reject `UPDATE` / `DELETE` / `TRUNCATE` on `audit_events` |
| At most one decision per submission | Partial unique index on `(submission_id) WHERE action IN ('APPROVED','REJECTED')` |
| Exactly one birth event per submission | Partial unique index on `(submission_id) WHERE action = 'SUBMITTED'` |
| Only legal status transitions are recorded | `CHECK` constraint (`SUBMITTED: null→PENDING`, decisions: `PENDING→APPROVED/REJECTED`) |
| A rejection always has a reason | `CHECK (action <> 'REJECTED' OR reason is non-empty)` |
| Submissions can only move `PENDING → APPROVED/REJECTED` | `BEFORE UPDATE OF status` trigger |
| No hard deletes orphan history | All foreign keys use `onDelete: Restrict` |

These guards defend the audit trail against **application bugs**, not a privileged attacker — the app connects as the table owner, which could in principle drop them. That framing is stated in the migration itself.

### API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | public | Passwordless mock sign-in by email |
| `POST` | `/api/auth/logout` | public | Clear the session cookie (no auth enforced) |
| `GET` | `/api/auth/me` | session | Current identity (id, name, email, role) |
| `POST` | `/api/submissions` | user | Submit a document |
| `GET` | `/api/submissions/my` | user | The caller's own submissions |
| `GET` | `/api/submissions/:id` | author / reviewer | Full detail + audit history |
| `GET` | `/api/submissions/:id/audit` | author / reviewer | Audit trail on its own |
| `POST` | `/api/submissions/:id/approve` | reviewer | Approve a pending submission |
| `POST` | `/api/submissions/:id/reject` | reviewer | Reject a pending submission (reason required) |
| `GET` | `/api/reviewer/submissions` | reviewer | All submissions + status counts |

Error responses map from a typed `AppError` hierarchy to HTTP status codes in one place:

| Code | Meaning |
| --- | --- |
| `400` | Validation error — bad or unknown fields, empty reject reason |
| `401` | No or invalid session |
| `403` | Authenticated but wrong role (a `USER` invoking a reviewer action) |
| `404` | Missing **or** not the owner (identical, so existence isn't leaked) |
| `409` | Submission already decided |

---

## Getting Started

### Prerequisites

- **Node.js 20.9+** (required by Next.js 16)
- **Docker** with Compose v2 (`docker compose …`)

`.env` is committed on purpose for this take-home (it holds only the local Docker connection string and a throwaway session secret), so there is no environment setup step.

### Setup

```bash
npm install
npm run setup      # docker compose up -d --wait  &&  prisma migrate deploy  &&  prisma db seed
npm run dev        # http://localhost:3000
```

`npm run setup` starts PostgreSQL 16 in Docker (published on host port **5433** to avoid colliding with a local Postgres on 5432), waits for it to be healthy, applies the migrations, and seeds the database.

### Seeded accounts

Sign-in is passwordless — pick an account on the login screen. Choosing "Reviewer" in the UI does **not** grant reviewer powers; the server re-reads the role from the database on every request.

| Name | Email | Role | Shown as |
| --- | --- | --- | --- |
| Bob Okafor | `bob@company.test` | `REVIEWER` | Reviewer |
| Alice Nguyen | `alice@company.test` | `USER` | Writer |
| Carol Mendes | `carol@company.test` | `USER` | Writer |

The seed creates **4 submissions** (2 pending, 1 approved, 1 rejected) and **6 audit events**. Alice authors three of the documents and Carol one — two separate writers exist specifically so ownership isolation is demonstrable.

### Tests

```bash
npm test           # vitest run  — requires the database from `npm run setup` to be running
```

The suite is 9 service-level tests. On start it provisions its own isolated database (`workspace_test`) by dropping/recreating it and applying the committed migration SQL through the `pg` driver, so it is self-contained and does not touch the development data.

---

## Key Design Decisions

- **PostgreSQL over SQLite (the exercise's default).** Chosen for production parity: native `enum` types, real transactional guarantees for the decision path, and database-level triggers/constraints to enforce the audit invariants. The tradeoff is that setup requires Docker rather than a single file.
- **Route Handlers *are* the API — no separate server.** One Next.js process serves both the UI and the REST API, which keeps the project small and the types shared end to end.
- **Service layer as the single authorization surface.** Both route handlers and server components call the same service functions and pass the acting user explicitly. Authorization is never duplicated in the UI, so it can't drift.
- **Mock authentication, real authorization.** Login is passwordless by email (there are no passwords to store). The session cookie value is `userId.hmac`, HMAC-SHA256–signed with `SESSION_SECRET` and verified in constant time; the user's **role is loaded from the database on every request**, never taken from anything the client controls.
- **The decision path is one transaction with a conditional update.** `updateMany WHERE status = PENDING` is simultaneously the state machine and the race guard: two reviewers deciding at once → the second matches zero rows and gets a `409`. The audit event is written in the same transaction, and the database backstops both halves independently.
- **Immutable documents.** Only a document's status changes, which keeps "previous value → new value" in the audit trail unambiguous and the history complete.
- **Input hardening at the edge.** Zod `strictObject` schemas reject unknown keys (so `status` or `authorId` can't be smuggled in); request bodies are size-capped and screened for NUL bytes and `__proto__`; unsafe methods get a same-origin check; responses are marked `no-store`.
- **Engine-less Prisma + Webpack default.** The Prisma client runs through the `@prisma/adapter-pg` driver adapter instead of the default native query engine, and `dev`/`build` default to `--webpack`. Both avoid native-binary crashes I hit in my development environment (the default Prisma engine and Turbopack). The Turbopack variants remain available as `dev:turbo` / `build:turbo`.

## Tradeoffs

- **Most reviewer filtering runs on the client.** Only reviewer keyword search (title + body) executes in the database; status, category, author, date range, and sorting are applied in the browser over the server-returned set, which is **capped at 100 rows**. At seed scale this is instantaneous and correct; past 100 rows the client-side filters would only see the first page. The writer's own list search is also client-side.
- **Authentication is mocked.** There are no passwords, sessions, or refresh flows a production app would need. The signed cookie carries no server-side expiry, so `logout` clears the browser cookie but cannot revoke a value captured beforehand.
- **Tests are service-level, not HTTP-level.** They exercise the layer where authorization lives, and the `AppError.status` codes they assert map 1:1 to the HTTP responses — but the transport wiring (route handlers, `http.ts` guards) is verified manually rather than by the automated suite.
- **The audit immutability guards assume a non-malicious operator.** They protect against application bugs; the app connects as the table owner and could drop them. Enforcing that properly would need a least-privilege database role.
- **`.env` is committed.** Deliberate, so the project runs on clone with zero configuration. It contains only local Docker credentials and a throwaway secret — no real secrets — and in a real project it would be gitignored and sourced from a secret store.

## What I Would Do Differently / Add With More Time

- **Push filtering into the query and add pagination** — move status/category/author/date into the `where` clause and paginate, removing the 100-row client-side ceiling.
- **Add HTTP/route-level tests** for the transport concerns the service tests don't cover (session/CSRF handling, status mapping), and a test that asserts the audit triggers actually reject a mutation.
- **Real authentication** — password or OAuth, server-tracked sessions with revocation and expiry.
- **A dedicated audit view** — history is currently a timeline beside the document plus its own endpoint; a standalone, filterable history page would help at scale.
- **A least-privilege database role** for the application so the immutability guards hold even against a compromised app.

## Time Spent

Roughly **12–16 hours**, spread across several sessions: design, the database layer and its hardening migration, the service/authorization layer, the ten route handlers and request hardening, the UI, and the test suite.

This ran longer than my initial estimate of about a day (~8 hours). Most of the overage went into **UI iteration** and into **working around native-binary crashes** in my development environment — the default Prisma query engine and Turbopack both failed on this machine, which I resolved by running Prisma through the `pg` driver adapter and defaulting the build to Webpack. The core backend came together close to expectation; the interface and the environment friction did not.

## AI-Assisted Development

This exercise was built with substantial AI assistance — Anthropic's Claude, via the Claude Code CLI. I used it for scaffolding, boilerplate (route handlers, Zod schemas, Prisma migrations), and iterating on the UI. I treated its output as a **draft to review**, not as finished code.

How I reviewed and validated that output:

- **Read every generated file** before keeping it, and rewrote or discarded anything I didn't understand or agree with.
- **Kept the automated suite green** (`npm test`) — nine service-level tests covering the authorization and audit guarantees, run against a real PostgreSQL instance.
- **Wrote negative tests, not just happy paths** — `USER → 403`, cross-user access → `404`, a repeated decision → `409`, an empty reject reason → `400`, and an assertion that a decision writes exactly one matching audit event.
- **Manually exercised both roles** end to end in the browser: submission, the review queue, approve/reject-with-reason, the audit timeline, and the ownership-isolation and wrong-role paths.
- **Adversarially reviewed the auth model.** An early iteration used a bare user-id session cookie. Because user ids are visible in audit timelines, a leaked reviewer id could be replayed as a forged session — a real `USER → REVIEWER` escalation. I fixed it by HMAC-signing the cookie value (verified in constant time) and re-reading the role from the database on every request, so the client can never assert its own privilege.
