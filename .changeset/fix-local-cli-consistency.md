---
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Make Local CLI lookup and output behavior consistent: accept trace and run IDs, support bare and kind-prefixed Catalog IDs, filter Index kind aliases, align cost reports with observability stats, resolve nested package roots correctly, provide global and Eval JSON output, use Index-specific chrome, and standardize invalid lint options as usage errors.

Restore runtime-discovered Eval execution and timeout facts across bundled Core boundaries, distinguish them from static-only Eval calls, and invalidate pre-fix Local Project Index snapshots.

Make `crux runtime generate` report progress and fail with a bounded timeout instead of hanging silently.
