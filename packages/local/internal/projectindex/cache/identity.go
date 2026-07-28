package cache

// ProjectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project
// Index snapshot.
//
// Bump this when persisted `.crux/cache/index-v2/epoch-*` snapshot shape, cache
// loading semantics, or client-visible Project Index metadata change in a way
// that stale snapshot masking after restart could hide from crux dev. Epoch 49
// preserves Eval arm placement and embedding facts from epoch 44, unconditional
// Rust/Oxc Static Index scheduling, Workspace snapshot usage relations, retained
// lint suppression evidence, the direct named-export evidence installed by
// Epoch 46, Epoch 47 prompt-text source-ref metadata, and Epoch 48 runtime-rich
// Eval timeout policy facts while adding canonical provider-visible tool Safety
// boundary metadata across restart boundaries in Epoch 49. Epoch 50 adds the
// privacy-safe effective observability policy to Project Identity snapshots.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 50
