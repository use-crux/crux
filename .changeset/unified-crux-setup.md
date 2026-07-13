---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
---

Add the provider-neutral `@use-crux/core/setup` contributor and planner contract
and the aggregate `crux setup` check/apply/JSON workflow. Runtime setup now
participates as a contributor through that single setup command.
Unhealthy reports exit nonzero, contributor failures remain isolated and
privacy-safe, and apply reports retain planning and adapter-reported failures.
