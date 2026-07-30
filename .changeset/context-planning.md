---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/openai": minor
"@use-crux/anthropic": minor
"@use-crux/google": minor
---

Add provider-neutral model capacity profiles, conservative unknown-model
fallbacks, and an optional authoritative token-counting adapter port. All
first-party language adapters can report the context window, default output
reserve, and counting confidence used for whole-request budget derivation.
