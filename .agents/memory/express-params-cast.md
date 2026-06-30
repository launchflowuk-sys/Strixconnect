---
name: Express req.params type casting
description: req.params values are typed string | string[] in this Express version; Drizzle eq() requires string.
---

## Rule
Always wrap `req.params.xxx` with `String()` before passing to Drizzle:
```ts
const userId = String(req.params.userId);
eq(users.id, userId)
```

**Why:** Express types `req.params` as `Record<string, string | string[]>`. Drizzle's `eq()` first overload only accepts `string | SQLWrapper`, not `string[]`. This causes TS2769 "no overload matches" errors at typecheck time even though the value is always a string at runtime.

**How to apply:** Every route handler that reads from `req.params` and passes the value to Drizzle must use `String(req.params.xxx)`.
