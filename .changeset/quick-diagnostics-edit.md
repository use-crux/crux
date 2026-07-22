---
"@use-crux/local": minor
---

Add `crux lsp`, a stdio language server that publishes Project Index lint
diagnostics, keeps ranges aligned with unsaved edits, explains findings on
hover, offers suppression and safe allowlisted companion-command actions, and
moves between an attached `crux dev` read model and its own watcher without
clearing diagnostics during handover. Add index-backed go-to-definition,
references, document and workspace symbols, definition context on hover,
finding-count inlay hints and code lenses, Devtools definition links, and
live editor settings for hints, lenses, and inline-decoration opacity.
