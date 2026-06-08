package devtools

// projectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project Index snapshot.
//
// Bump this when an existing .crux/cache/index/index.json snapshot could hide a new read-model
// field or changed cache semantics after restarting crux dev. Source-level AST and semantic fact
// caches are versioned in @crux/indexer.
const projectIndexSnapshotCacheEpoch = 5
