---
"@use-crux/core": major
"@use-crux/convex": major
"@use-crux/upstash": major
---

Add atomic `CruxStore.setIfAbsent()` support and use it for task creation so concurrent duplicate task IDs fail with `DuplicateTaskIdError`. Store adapters now need to implement the conditional insert primitive; Convex component refs and the Upstash Convex-backed store config include a matching `insert` mutation.
