---
name: Express sub-router RBAC scoping
description: Using router.use(requireSuperAdmin) at the sub-router top level without a path prefix blocks ALL API requests, not just that router's routes.
---

## The Rule
Never call `router.use(requireAuth, requireSuperAdmin)` at the top of a sub-router that is mounted without a path prefix in the parent.

## Why
In Express, `router.use(fn)` without a path matches every request entering that router. When the parent mounts the sub-router without a prefix (`mainRouter.use(subRouter)`), EVERY API request passes through the sub-router's middleware — including requests meant for entirely different routers that are mounted later. If `requireSuperAdmin` sends a 403 (without calling `next()`), the request chain terminates and no other routes are reachable for non-super-admin users.

## How to Apply
Two safe patterns:
1. **Inline per-route**: Add `requireSuperAdmin` as a route-level middleware argument:
   `router.get("/tenants", requireAuth, requireSuperAdmin, handler)`
2. **Path-prefixed mount**: Mount the sub-router with a prefix so it only receives matching requests:
   `mainRouter.use("/tenants", tenantsRouter)` — and strip `/tenants` from the route paths inside.

Pattern 1 is lower-risk (no path renaming). Pattern 2 is more idiomatic.

## Real Incident
`tenantsRouter` had `router.use(requireAuth, requireSuperAdmin)` at line 10, mounted with no prefix in `routes/index.ts`. This blocked ALL tenant-user access to every API endpoint (assets, compliance-types, compliance-items, dashboard, etc.) even though these routes were in completely separate routers. Fixed by moving `requireSuperAdmin` to each individual route handler in tenants.ts.
