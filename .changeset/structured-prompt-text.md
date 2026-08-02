---
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Give compiler-proven callback PromptText—including canonical `md` nested inside
interpolation callbacks—the same syntax-exact editor insights as direct
PromptText. Keep Local watch indexing incremental when a newly added source is
absent from the previous source graph.
