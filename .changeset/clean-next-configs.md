---
"@use-crux/core": patch
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Make the Next build wrapper loadable from TypeScript Next configs, accept declared
Next config values with a nullable Webpack hook, and omit unused Eval capability
bindings from generated entries without deployable Evals.

Resolve authored config imports through project `tsconfig` and `jsconfig` path
aliases with cache-safe extended-config tracking, and make `crux setup --apply`
ensure project-local `.crux/` state is ignored by Git.
