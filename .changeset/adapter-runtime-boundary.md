---
"@use-crux/core": minor
---

Keep adapter conformance helpers on `@use-crux/core/adapter/testing` so production
adapter imports no longer load Vitest. Import test helpers from the explicit testing
subpath instead of `@use-crux/core/adapter`.
