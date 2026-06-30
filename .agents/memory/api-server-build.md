---
name: API server build and restart requirement
description: api-server compiles once at startup; source changes require a manual rebuild + workflow restart to take effect.
---

## Rule
The api-server `dev` script is `build && start` — it compiles the TypeScript bundle **once** at workflow start, then runs the compiled output. Changes to any source file in `src/` are NOT picked up automatically.

After any source change to the api-server, always:
1. Run `pnpm --filter @workspace/api-server run build`
2. Restart the `artifacts/api-server: API Server` workflow

**Why:** Unlike Vite's HMR or `tsx --watch`, esbuild compiles once and the Node process keeps running. Routes added after the initial build simply don't exist in the running server — they return 404 with no error logged, which looks identical to a routing mistake.

**How to apply:** Any time api-server source files change (routes, middleware, lib files), always rebuild and restart before testing. If a route that exists in source returns 404, the first thing to check is whether the bundle is stale.

## Vite proxy for dev
The frontend (dashboard) must proxy `/api` requests to the API server. Config in `artifacts/dashboard/vite.config.ts`:
```ts
proxy: {
  "/api": {
    target: `http://localhost:${process.env.API_PORT ?? 8080}`,
    changeOrigin: true,
  },
},
```
Without this, `/api/auth/login` hits the Vite dev server (not the API) and returns 404.
