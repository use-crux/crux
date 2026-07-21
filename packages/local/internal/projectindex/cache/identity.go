package cache

// ProjectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project
// Index snapshot.
//
// Bump this when persisted `.crux/cache/index-v2/epoch-*` snapshot shape, cache
// loading semantics, or client-visible Project Index metadata change in a way
// that stale snapshot masking after restart could hide from crux dev. Epoch 44
// preserves Eval arm placement and embedding facts from epoch 43. It also preserves
// unconditional Rust/Oxc Static Index scheduling while installing authored
// Workspace snapshot usage relations for Catalog presentation.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 44
