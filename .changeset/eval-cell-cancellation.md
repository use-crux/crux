---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
---

Add authored Eval and Case timeout policies, task-scoped cancellation context,
and automatic signal and nested-budget propagation for managed AI tasks.
Timed-out tasks now produce structured complete Run outcomes with comparable
Baseline coverage, while versioned local and remote readers preserve existing
artifacts and quarantine late evidence or result publication. Project Index
and the hydrated Eval catalog expose effective and inherited policy, while Eval
Runs and normal Runs show structured timeout causes and counts.
