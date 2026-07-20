package cache

// ProjectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project
// Index snapshot.
//
// Bump this when persisted `.crux/cache/index-v2/epoch-*` snapshot shape, cache
// loading semantics, or client-visible Project Index metadata change in a way
// that stale snapshot masking after restart could hide from crux dev. Epoch 41
// installs client-visible Eval arm placement metadata so a persisted base-task
// capability projection cannot hide Current or Variant execution requirements.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer because their persisted projections are unchanged.
const ProjectIndexSnapshotCacheEpoch = 41
