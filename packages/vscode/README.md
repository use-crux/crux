# Crux for Visual Studio Code

This private extension starts `crux lsp` for TypeScript and JavaScript
workspaces containing `crux.config.ts`, `crux.config.js`, or
`crux.config.mjs`.

The editor host keeps the extension fully inactive in an untrusted workspace.
Grant workspace trust before binary discovery, diagnostics, hover, actions, or
inline decorations can start.

It publishes Project Index lint diagnostics, links rule documentation, and
offers rich hover, source-comment suppression, and trusted allowlisted command
actions. Client-side inline decorations can summarize findings after affected
lines and automatically coexist with general inline-diagnostics extensions.
The language server attaches to a matching `crux dev` process when available
and otherwise indexes the workspace itself.

Set `crux.binaryPath` when the Crux CLI is not available from the workspace or
`PATH`. Use **Crux: Restart Language Server** after replacing a binary in
place; changes to `crux.port` or `crux.binaryPath` restart automatically.
Use `crux.decorations.mode` and `crux.decorations.maxLength` to control the
extension-only inline presentation.

See the [`crux lsp` reference](https://cruxjs.dev/docs/reference/lsp) for the
command surface, settings, and other-editor setup.
