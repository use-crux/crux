---
"@use-crux/core": minor
"@use-crux/devtools": patch
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Add runtime-backed `workspace.watch()` subscriptions for durable create, update, delete, and rename events, including cursor polling, unsubscribe, and transaction-aware event emission.

Classify `workspace.watch()` as read-style Project Index data access and bump local/indexer cache identities so existing snapshots do not mask the new facts.

Update local devtools workspace read models so deleted files are removed from the tree and observed rename/move operations update the visible destination path.

Render `watch` as a recognized read-style Project Index data-access operation in the devtools intelligence panel.
