# Crux for Visual Studio Code

Crux adds Project Index diagnostics, semantic completion, navigation, hover,
code actions, symbols, inlay hints, code lenses, and optional inline finding
text to TypeScript and JavaScript workspaces. It starts `crux lsp`, attaches to
a matching `crux dev` process when one is available, and otherwise indexes the
workspace itself.

The extension works in Visual Studio Code and compatible editors that install
VSIX files. It remains fully inactive in an untrusted workspace; grant
workspace trust before binary discovery or language-server startup can occur.

## Install the extension and CLI

Download the VSIX matching the CLI version from the
[Crux GitHub Release](https://github.com/use-crux/crux/releases) you want to
use. Install the CLI from npm, then install the downloaded VSIX:

```bash
npm install -g @use-crux/local
code --install-extension crux-vscode-<version>.vsix
```

You can instead run **Extensions: Install from VSIX...** in the editor command
palette. The extension and CLI use lockstep release versions. Stable releases
are recommended; GitHub entries marked **Pre-release** are nightly builds from
the source commit named in their notes.

For a project-local CLI, install `@use-crux/local` in the workspace:

```bash
npm install --save-dev @use-crux/local
```

The extension discovers `node_modules/.bin/crux` on Linux and macOS and the
corresponding `.cmd` shim on Windows; native `.exe` candidates are also
supported. Discovery order is an explicit `crux.binaryPath`, trusted workspace
candidates, then `PATH`. Every selected binary must successfully return
`crux --version` before the server starts.

If npm is unsuitable, download the archive for your OS and architecture from
the same release, verify it with `SHA256SUMS`, extract both executables, and set
`crux.binaryPath` to the extracted `crux` or `crux.exe`. See the
[`crux lsp` reference](https://cruxjs.dev/docs/reference/lsp#direct-download)
for exact filenames and checksum commands.

GitHub-installed VSIX files and direct-download binaries do not update
automatically. Download and install both artifacts again when changing Crux
versions.

## Semantic completion

In supported first-party dependency slots, Crux completion offers compatible
prompts, contexts, MCP servers, tools, agents, and routing definitions. It can
reuse an existing binding or add a safe relative named import. Ambiguous or
unsafe candidates are omitted without affecting the editor's normal
TypeScript completion.

Completion parses a bounded copy of the current unsaved document, but the
Project Index remains save-based. Unsaved text never changes diagnostics,
navigation, caches, or index generation, and it is never logged or persisted.
The feature requires workspace trust and fails softly during cancellation,
reindexing, reconnects, unsupported syntax, or worker unavailability.

The [semantic completion reference](https://cruxjs.dev/docs/reference/lsp-completion)
lists every supported slot, buffer limits, privacy behavior, and initial
limitations.

## Configuration

Use **Crux: Restart Language Server** after replacing a binary in place;
changes to `crux.port` or `crux.binaryPath` restart automatically. Settings for
lint filtering, hints, lenses, trace output, and inline presentation are listed
in the [`crux lsp` reference](https://cruxjs.dev/docs/reference/lsp).

## Support

- [Documentation](https://cruxjs.dev/docs/reference/lsp)
- [Repository](https://github.com/use-crux/crux)
- [Issues](https://github.com/use-crux/crux/issues)
- [Apache 2.0 license](https://www.apache.org/licenses/LICENSE-2.0)
