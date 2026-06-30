---
"@use-crux/core": minor
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

`finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy; `read(path, { version })` fetches the pinned content.

Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.
