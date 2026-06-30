---
name: lib/db compilation requirement
description: lib/db uses TypeScript project references (composite:true); declaration files must exist in dist/ before dependent packages can typecheck.
---

## Rule
After any schema changes in `lib/db/src/schema/`, run:
```
npx tsc -p lib/db/tsconfig.json
```
before running typecheck on `@workspace/api-server` or any other package that references it.

**Why:** lib/db has `composite: true` and `emitDeclarationOnly: true` in its tsconfig. TypeScript project references require compiled `.d.ts` files in `dist/` — they cannot read source `.ts` files through references. Without this step, every import from `@workspace/db/schema` errors with "has no exported member".

**How to apply:** Any time schema files are added or modified in `lib/db/src/schema/`, compile lib/db first. There is no `build` npm script — use `npx tsc -p lib/db/tsconfig.json` directly.
