package cache

// ProjectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project
// Index snapshot.
//
// Bump this when persisted `.crux/cache/index-v2/epoch-*` snapshot shape, cache
// loading semantics, or client-visible Project Index metadata change in a way
// that stale snapshot masking after restart could hide from crux dev. Epoch 39
// removes legacy Quality metadata from the persisted read model. Prior deployed
// Eval registry corroboration, default Static Index scheduling, runtime owner
// facts, and all-kind extractor provenance remain included.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 39
