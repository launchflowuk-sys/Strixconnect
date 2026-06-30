---
name: Orval indexFiles collision fix
description: How to prevent Orval zod generator from creating a naming collision when an operation has both path params and query params.
---

## The Rule
Set `indexFiles: false` in the orval zod output config and maintain a custom `lib/api-zod/src/index.ts` that only exports from `./generated/api`.

## Why
Orval v8.9.1 zod client generates:
- `generated/api.ts`: `{Op}Params = zod.object(...)` for **path** params
- `generated/types/{opCamelCase}Params.ts`: `type {Op}Params = {...}` for **query** params

Both have the same `{Op}Params` name. The auto-generated `index.ts` does `export * from "./generated/api"` AND `export * from "./generated/types"` — causing TS2308 ambiguous re-export error.

`indexFiles: false` stops Orval from regenerating `index.ts`. The custom `index.ts` (only `export * from "./generated/api"`) skips `generated/types/` entirely — safe because `generated/types/` has zero consumers in this project.

## How to Apply
- `lib/api-spec/orval.config.ts` zod section must have `indexFiles: false`
- `lib/api-zod/src/index.ts` must be: `export * from "./generated/api";`
- Do not add `export * from "./generated/types"` — this re-introduces the collision
- This applies to ANY future operation that has both path params AND query params
- The `generated/types/` directory is still generated (types are available via `import type` from the file directly if ever needed) but not re-exported
