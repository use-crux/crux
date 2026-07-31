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
// Epoch 51 adds bounded media stream operation facts.
// Epoch 52 adds semantic PromptText fragment-join evidence.
// Epoch 53 adds PromptText diagnostic evidence.
// Epoch 54 adds PromptText refactor source-ref metadata and compiler-owned
// source classification across restart boundaries. Epoch 55 adds authored
// evidence.record definitions, safe facts, refs, relations, and lints.
// Epoch 56 adds authored Thread definitions, bindings, runtime joins,
// context-planning structure, hook/budget refs, and conclusive lints.
// Epoch 57 adds first-class Thread lint findings and descriptors.
// Epoch 58 prevents snapshots from retaining sources deleted while offline.
// Epoch 59 combines the independently advanced Thread and context-planning
// snapshot contracts.
// Epoch 60 adds authored Connected Knowledge definitions, view children, and
// static relation facts.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 60
