---
"@use-crux/core": minor
"@use-crux/convex": minor
"@use-crux/upstash": minor
---

Add atomic `RecordStore.create()` support and use it for task creation so concurrent duplicate task IDs fail with `DuplicateTaskIdError`. Record adapters now need to implement the conditional insert primitive; Convex component refs include a matching `insert` mutation.
