---
"@use-crux/core": minor
"@use-crux/indexer": patch
"@use-crux/otel": patch
---

Fix workspace blob text/JSON read-back, byte-windowed text reads, globstar listings, bounded manifests, list limit pushdown, and privacy-safe workspace path hashes in OTel attributes.

Add per-call workspace namespace overrides for direct methods and manually created tools, tighten generated workspace tool map types, and allow write tools to accept JSON arrays and scalar JSON values.

Add filesystem-style workspace operations for `exists`, `stat`, `append`, `rename`/`move`, `copy`, and `grep`, plus default generated `renameWorkspaceFile` and `grepWorkspace` tools.

Add the workspace artifacts facet with draft/final status, artifact kind metadata, finalization, artifact queries, download references, provenance capture, and manifest deliverables.

Add workspace retention and quota controls with TTL passthrough for supporting stores plus `maxFileBytes` and `maxNamespaceBytes` write-time guards, and document the complete V0 workspace surface.

Expose V0 workspace activity in local devtools, OTel, and Project Index: workspace OTel spans now use workspace-specific operation/path-hash attributes, devtools preserve privacy-safe path-hash labels and artifact metadata, and Project Index facts include workspace operator config, generated tool posture, and exact V0 workspace data-access operations.

Harden V0 workspace filesystem and artifact edge cases: filesystem mutations now share write-limit and retention enforcement, `move` is distinct from `rename` in operation metadata, glob/list/grep reads respect mount access, and artifact observability avoids raw workspace paths.

Add source-backed workspace mounts for virtual provider roots. `read`, `list`, `grep`, `exists`, and `stat` can now delegate to custom or retriever mount sources, retrievers can also be adapted with `retrieverWorkspaceMountSource()`, prompt context includes can read virtual files without copying bytes into the workspace store, local copies can materialize readable virtual text/JSON files, unscoped grep searches source-backed mounts, and custom source mounts can opt into provider-backed `write`/`edit`/`append`, provider-destination `copy`, and `delete` hooks when mounted with `access: "readwrite"`.

Tighten source-backed mount correctness: copied string JSON now stays JSON, missing or truncated source reads fail instead of silently materializing partial local copies, provider write read-backs tolerate eventual consistency, fallback grep uses bounded source listings, retriever-backed limits apply after filtering, regex grep rejects risky patterns, and workspace JSON value guards now reject non-finite, cyclic, and non-plain values.
