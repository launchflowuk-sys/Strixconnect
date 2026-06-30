---
name: Production DB is source of truth
description: All system/reference data must be inserted via server-startup sync, never seeded into dev only. Production DB always wins.
---

## Rule

Any data that must exist in the live app (system compliance types, reference data, seed users) must be written into a **server-startup sync function**, not a one-off dev seed script.

**Why:** The dev and production databases are completely separate. Scripts run against the dev database never reach production. This burned us when 22 new compliance types were seeded into dev but the published app showed only the original 8 — because the seed script was never run against production.

**How to apply:**
- New system/reference rows → add them to the relevant startup sync (e.g. `artifacts/api-server/src/lib/sync-compliance-types.ts`) which runs on every server boot.
- The sync must be idempotent (skip rows that already exist, update only when something meaningful changed like a name).
- Dev DB is throwaway. If dev and production differ, production is correct.
- Acceptance criteria for any task that adds system/reference data must include confirming the data appears in the **deployed/published app**, not just dev.
