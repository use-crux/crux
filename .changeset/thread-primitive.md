---
"@use-crux/core": minor
"@use-crux/upstash": minor
"@use-crux/convex": minor
---

Add linearizable single-key record mutation through native or versioned
compare-and-set adapters, including memory, Upstash Redis, and Convex storage.

Replace the top-level `config.persistence` setting with the standard
`config.storage` bundle. The legacy key now fails with targeted migration
guidance; move `{ records }` directly to `storage`.
