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

Plan every Core-owned language request against model capacity before dispatch.
Add per-call `inputBudget` settings, typed pre-dispatch composition failures,
and linked JSON-safe request receipts with redacted token breakdowns on
generation and stream steps. Adapters may report transport retries for the
same sealed request so live receipt inspection can expose the retry count.
