package devtools

// projectIndexSnapshotCacheEpoch invalidates the Go-owned persisted Project Index snapshot.
//
// Bump this when persisted Project Index cache semantics change in a way that
// stale local data could hide after restarting crux dev. Source-level AST and
// semantic fact caches are versioned in @crux/indexer.
const projectIndexSnapshotCacheEpoch = 16
