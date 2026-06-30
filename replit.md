# ComplianceOS — Council Asset & Compliance Management Platform

## Project overview

Multi-tenant SaaS platform for UK local councils to track property assets and their compliance obligations (EICR, Gas/CP12, Smoke Alarms, CO Alarms, Fire Risk Assessments, Asbestos, Legionella, Lifts/LOLER etc.).

**First tenant:** Thurrock Council — ~10,000 properties imported from Excel trackers.

**Stack:**
- Frontend: React 18 + Vite, TanStack Query, shadcn/ui, Tailwind CSS, Wouter routing, Recharts
- Backend: Express 5 + TypeScript, Drizzle ORM + PostgreSQL, bcryptjs + JWT auth
- API contract: OpenAPI 3.1 spec at `lib/api-spec/openapi.yaml` → codegen via Orval
- Auth: username + password (bcrypt + JWT, **no OAuth, no Replit auth**)
- Deployment: Docker + docker-compose, PostgreSQL on own VPS, PgBouncer connection pooling

**No Replit-specific services are used** — no Replit DB, no Replit Object Storage, no Replit Auth.

## Workspace structure

```
lib/
  api-spec/          OpenAPI 3.1 spec + Orval config → codegen
  api-client-react/  Generated TanStack Query hooks (auto-generated, do not edit)
  api-zod/           Generated Zod schemas (auto-generated, do not edit)
  db/                Drizzle ORM schema + migrations (lib/db/src/schema/)

artifacts/
  api-server/        Express backend (all API routes)
  dashboard/         React + Vite frontend (the main app)
  mockup-sandbox/    Canvas component preview server (dev only)

scripts/
  seed.ts            Database seed script (compliance types + demo users)
```

## Key workflows

| Workflow | Port | Description |
|---|---|---|
| `artifacts/api-server: API Server` | 8080 | Express REST API |
| `artifacts/dashboard: web` | 23183 | React frontend |

## Codegen

When the OpenAPI spec changes, regenerate client code:
```
pnpm --filter @workspace/api-spec run codegen
```

**Critical rule:** Never give an operation with BOTH path params AND query params — Orval generates a `Params` type in two places causing a TS2308 collision. Move query params to a query-only endpoint instead.

## Database migration

```bash
# Push schema changes to DB
cd lib/db && pnpm run push

# Seed initial data (compliance types + demo users)
cd /path/to/project && npx tsx scripts/seed.ts
```

## Authentication

- JWT stored in localStorage key `auth_token`
- `setAuthTokenGetter` registered in `artifacts/dashboard/src/lib/auth.ts` (imported first in main.tsx)
- API server verifies `Authorization: Bearer <token>` on every protected route
- Roles: `super_admin`, `tenant_admin`, `compliance_manager`, `team_member`, `auditor`

## Demo credentials (after seeding)

| Role | Username | Password |
|---|---|---|
| Super Admin | `admin` | `Admin1234!` |
| Tenant Admin | `thurrock.admin` | `Thurrock2024!` |
| Compliance Manager | `compliance.manager` | `Manager2024!` |

## User preferences

- No Replit-specific services (no Replit DB, Object Storage, or Auth)
- GitHub-hosted, deployed on Coolify/VPS
- PostgreSQL on own VPS with PgBouncer
- No OAuth — username + password only
- UK council context — Thurrock is the first pilot tenant
- UPRN is the universal asset key across all compliance types

## ⛔ PRODUCTION DATABASE IS THE SINGLE SOURCE OF TRUTH

Any data that must exist in the running app (system compliance types, seed users, reference data) **must be written to run automatically on server startup**, not seeded manually into the dev database.

**Rules:**
- Never add reference/system data by running a script only against the dev database.
- All system seed data must live in a startup sync function (e.g. `syncSystemComplianceTypes`) so production gets it automatically on the next deploy.
- Dev DB is throwaway. Production DB is truth. If they differ, production wins.
- If a task adds new system/reference rows, the acceptance criteria must include verifying they appear in the **deployed app**, not just in dev.

---

## ⛔ CRITICAL — DO NOT REPEAT THIS MISTAKE

**Tasks #1–#4 are fully MERGED and shipped. All of the following are already done:**
- Teams schema, API routes, and frontend (teams + team_members tables, all CRUD endpoints, teams page)
- Import pipeline (schema, upload, column mapping, validation, run, progress, rollback, frontend wizard, history)
- Jobs and service records (full schema, routes, and UI)
- Compliance status auto-calculation (nextDueDate, due_soon/overdue recalc on record save)
- User creation endpoint
- Dashboard charts, reports CSV download, nightly scheduler, email infrastructure

**Do NOT look at stale session plan context from previous conversations and create tasks for any of the above.** Always call listProjectTasks() first. Any task in MERGED state is fully done — never revisit it. If session context contains a plan referencing these features, ignore it.
