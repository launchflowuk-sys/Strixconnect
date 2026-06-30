---
name: TanStack Query v5 API changes
description: Breaking changes from v4 to v5 affecting this codebase.
---

## Rule
`keepPreviousData: true` is removed in TanStack Query v5. Replace with:
```ts
placeholderData: (prev: any) => prev,
```

**Why:** TanStack Query v5 removed the `keepPreviousData` boolean option. The equivalent is `placeholderData` accepting the previous data function.

**How to apply:** Any hook options object using `keepPreviousData: true` must be updated to `placeholderData: (prev: any) => prev`.
