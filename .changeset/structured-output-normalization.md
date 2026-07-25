---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/openai": minor
"@use-crux/anthropic": minor
"@use-crux/google": minor
---
Normalize structured response and tool-input schemas through provider capability
profiles. Crux now compiles provider-compatible wire schemas, decodes transport
sentinels before Safety, validates once with the authored schema, and exposes the
parsed output consistently across native, AI SDK, generate, and stream routes.

Structured outputs are now always validated. `validationRetry` controls whether
another attempt is made; without it, invalid structured output throws instead of
being returned. Adapter authors must declare their structured-output
capabilities and use the prepared `outputSchema` supplied to request builders.
AI SDK and provider adapters now accept `@use-crux/mcp` 0.7 peers.
