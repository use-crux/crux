package cache

// ProjectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project
// Index snapshot.
//
// Bump this when persisted `.crux/cache/index-v2/epoch-*` snapshot shape, cache
// loading semantics, or client-visible Project Index metadata change in a way
// that stale snapshot masking after restart could hide from crux dev. Epoch 45
// preserves Eval arm placement and embedding facts from epoch 44. It preserves
// unconditional Rust/Oxc Static Index scheduling and Workspace snapshot usage
// relations while installing retained lint suppression evidence across restart
// boundaries.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 45
