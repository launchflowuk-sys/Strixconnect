---
name: Orval body-type collision
description: When an OpenAPI operation has path params + inline requestBody, Orval generates the body type in two places causing TS2308 duplicate export.
---

## The Rule
For any operation that has path parameters AND a requestBody, never use an inline body schema. Always define the body as a named component schema and reference it with `$ref`.

## Why
Orval's Zod generator writes the body type as both:
1. `export const AddTeamMemberBody = zod.object({...})` in `api.ts`
2. `export type AddTeamMemberBody = ...` in `types/addTeamMemberBody.ts`

Then `lib/api-zod/src/index.ts` does `export * from './generated/api'` and `export * from './generated/types'`, which re-exports both → TS2308 "has already exported a member named X".

## How to Apply
- Operations with NO path params (e.g. POST /teams): inline body is fine — Orval only writes it to `api.ts`.
- Operations WITH path params (e.g. POST /teams/{teamId}/members): create a named schema (e.g. `TeamMemberInput`) and use `$ref: "#/components/schemas/TeamMemberInput"` in the requestBody.
- Fixed examples: `addTeamMember` → `TeamMemberInput`; `saveImportMapping` → `ImportMappingInput`.
