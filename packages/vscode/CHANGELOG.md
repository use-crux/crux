# crux-vscode

## 0.2.0

### Minor Changes

- 9b4d06e: Add `crux lsp`, a stdio language server that publishes Project Index lint
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

  Add PromptText-aware editor support for canonical Core `md` templates. One
  bounded Rust analysis now drives theme-aware Markdown-role highlighting,
  folding, heading symbols, safe literal links, static preview, semantic
  diagnostics, and versioned quick fixes while preserving native TypeScript
  behavior inside interpolations. Identity-sensitive results fail closed against
  saved semantic generation and source hashes; transient source and preview
  content never enter Project Index, caches, logs, or broadcasts.

  The VS Code extension adds explicit static preview, runtime exact preview, and
  latest-Run commands. Exact preview discovers a currently configured Prompt,
  requires confirmation, and invokes `Prompt.inspect()` without model
  generation, tool calls, or Run creation. Latest Run resolves current ownership
  and SQLite ordering at click time, with no cached selection or automatic
  navigation. The embedded Devtools routes are bounded, no-store, cancellation
  aware, and keep preview inputs/results in memory only.

  Distribute the editor extension as a checksum-verified, lockstep GitHub Release
  asset for Visual Studio Code and Cursor. `crux editor install vscode|cursor`
  downloads the VSIX matching the running CLI version, verifies `SHA256SUMS`, and
  installs only into the explicitly selected editor; `--download-only` supports
  managed environments. Release builds now embed that same stable or nightly
  version in every native CLI, and release reconciliation shares the validated
  asset set so the VSIX, six native archives, and checksums cannot disappear
  after a successful staging pass.
