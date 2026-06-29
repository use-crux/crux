---
"@use-crux/core": patch
---

Refined the internal `config()` runtime lifecycle so config-owned runtime state, observability, plugins, devtools fallback, bridge setup, and teardown are applied through a tested transaction boundary.
