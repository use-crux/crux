---
"@use-crux/core": minor
---

Support optional properties inside discriminated union branches for providers that require all properties (such as OpenAI strict mode). Structured-output decode operations recorded inside a discriminated union now carry branch guards on the union's discriminator, so a transport `null` sentinel is deleted only for the branch that produced it and an authored `null` in a sibling branch survives, both in batch decoding and in streamed safety-gated output. Ambiguous non-discriminated unions with branch-level optional properties are still rejected before transport, and the decode manifest version is bumped.
