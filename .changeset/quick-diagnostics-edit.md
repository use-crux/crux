---
"@use-crux/local": minor
"@use-crux/indexer": minor
---

Add `crux lsp`, a stdio language server that publishes Project Index lint
diagnostics, keeps ranges aligned with unsaved edits, explains findings on
hover, offers suppression and safe allowlisted companion-command actions, and
moves between an attached `crux dev` read model and its own watcher without
clearing diagnostics during handover. Add index-backed go-to-definition,
references, document and workspace symbols, definition context on hover,
finding-count inlay hints and code lenses, Devtools definition links, and
live editor settings for hints, lenses, and inline-decoration opacity. Publish
the lockstep VSIX, six native CLI archives, and checksums on stable and nightly
GitHub Releases; discover trusted project-local npm CLI shims on Unix and
Windows, and provide npm-first plus direct-download installation guidance.
Add Project Index-aware semantic completion for supported first-party prompt,
context, MCP, tool, agent, handoff, and routing dependency slots. Completion
uses a bounded, private unsaved-document overlay, safe named-import edits, and
the existing persistent compiler in both attached and own modes. Cross-file
items require compiler-proven direct named-export evidence. This additive
Project Index metadata advances the static, semantic, and local snapshot cache
identities, so upgrades automatically reindex instead of reusing an older
snapshot.
