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
// Epoch 56 adds Effect definitions and Thread definitions, call-site and
// binding evidence, runtime joins, runtime-observability identity, and
// context-planning structure.
// Epoch 57 preserves distinct same-identity Effect call-site evidence and adds
// first-class Thread lint findings and descriptors.
// Epoch 58 combines Effects and context-planning snapshots and prevents stale
// sources deleted while offline from surviving a restart.
// Epoch 59 adds Effect export metadata and the integrated Thread snapshot.
// Epoch 60 combines the independently advanced Effect LSP and canonical Thread
// history snapshot contracts so neither parent cache can mask the other.
// Epoch 61 was independently assigned to evidence-backed irreversible Effect
// findings on the Effects branch and authored Connected Knowledge definitions,
// Connected Knowledge lint findings, view children, and static relation facts
// on main.
// Epoch 62 advances the integrated Connected Knowledge snapshot contract.
// Epoch 63 combines the independently advanced Effect boundary lint and
// Connected Knowledge snapshot contracts so neither parent cache can mask the
// other.
// Epoch 64 advances the direct Agent-tool relation contract so mixed tool/agent
// tool maps keep typed native-direct edges across restart boundaries.
// Epoch 65 combines that contract with dynamic nested PromptText identity across
// restart boundaries so neither independently assigned epoch 64 can mask the
// other.
// Epoch 66 adds recoverable Effect Runtime-addressability findings and their
// rule descriptor across restart boundaries.
// TS-owned AST and semantic fact cache identity remain versioned in
// @use-crux/indexer.
const ProjectIndexSnapshotCacheEpoch = 66
