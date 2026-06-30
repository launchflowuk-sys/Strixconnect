---
name: Orval codegen queryKey requirement
description: Orval-generated TanStack Query hooks require an explicit queryKey in the query options object.
---

## Rule
When passing a `query:` options object to an Orval-generated hook, always include `queryKey`:
```ts
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

useGetMe({
  query: {
    queryKey: getGetMeQueryKey(),
    enabled: !!token,
  }
});
```

**Why:** The generated UseQueryOptions type marks `queryKey` as required. Omitting it causes TS2741 "Property 'queryKey' is missing". Each hook has a matching `getXxxQueryKey(params?)` export.

**How to apply:** Import `getXxxQueryKey` alongside every hook that uses a `query:` options block.
