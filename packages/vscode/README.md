# Crux for Visual Studio Code

This private P1 extension starts `crux lsp` for TypeScript and JavaScript
workspaces containing `crux.config.ts`, `crux.config.js`, or
`crux.config.mjs`.

It publishes Project Index lint diagnostics, links rule documentation, and
offers source-comment suppression quick fixes. The language server attaches to
a matching `crux dev` process when available and otherwise indexes the
workspace itself.

Set `crux.binaryPath` when the Crux CLI is not available from the workspace or
`PATH`. Use **Crux: Restart Language Server** after replacing a binary in
place; changes to `crux.port` or `crux.binaryPath` restart automatically.

See the [`crux lsp` reference](https://cruxjs.dev/docs/reference/lsp) for the
command surface, settings, and other-editor setup.
