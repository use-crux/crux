---
"@use-crux/ai": patch
"@use-crux/core": patch
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Restore observability configuration across bundled server module copies and
reconcile abandoned activity without treating it as currently running.

Also preserve provider model metadata and grounded prompt types, and make
omitted Static Index configuration use the documented default. Reject malformed
shared runtime registry ancestry and hook layers before duplicate module copies
adopt them.
