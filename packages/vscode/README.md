# Crux for VS Code and Cursor

Author Markdown-aware prompts directly in TypeScript without giving up native
TypeScript completion, hover, rename, diagnostics, or navigation. Crux connects
your editor to the Project Index and Devtools so authored definitions, static
structure, exact runtime inspection, and captured Runs stay one workflow.

The extension supports Visual Studio Code 1.90+ and Cursor through its VS Code
extension compatibility. It remains inactive in an untrusted workspace; grant
workspace trust before binary discovery or language-server startup can occur.

## What it adds

- PromptText Markdown highlighting and folding that stops at interpolation
  boundaries while TypeScript continues to own each expression.
- Safe, read-only static previews with placeholders for unknown values.
- Explicit runtime-backed exact previews with schema-informed inputs in
  Devtools—opening or editing a preview never executes a prompt.
- One-click navigation to the latest captured Run, including PromptText
  provenance and token attribution when capture policy permits it.
- Hard composition diagnostics and conservative fixes for invalid
  interpolations, inline sequences, and proven `md.json()` failures.
- Project Index completion, definitions, references, symbols, hover, inlay
  hints, code lenses, and Catalog evidence.

## Install in VS Code or Cursor

Install the Crux Local CLI, then let it fetch, verify, and install the VSIX from
the matching GitHub Release:

```bash
npm install -g @use-crux/local

crux editor install vscode
# or
crux editor install cursor
```

The command uses the running `crux --version`, downloads that exact release's
VSIX and `SHA256SUMS`, verifies the extension, and invokes only the editor you
selected. It never substitutes another version.

For a project-local CLI:

```bash
npm install --save-dev @use-crux/local
npx crux editor install vscode
```

Crux is not published to Visual Studio Marketplace or Open VSX yet. GitHub
Release VSIX files do not update automatically.

### Install a downloaded VSIX manually

Download `crux-vscode-<version>.vsix` and `SHA256SUMS` from the
[matching Crux GitHub Release](https://github.com/use-crux/crux/releases), or
download a verified copy without launching an editor:

```bash
crux editor install vscode --download-only ./artifacts
```

Then install it with the appropriate CLI:

```bash
code --install-extension ./crux-vscode-<version>.vsix --force
cursor --install-extension ./crux-vscode-<version>.vsix --force
```

In either editor, you can instead open the command palette and run
**Extensions: Install from VSIX...**.

### Upgrade or uninstall

Upgrade Local and reinstall the same version of the extension:

```bash
npm install -g @use-crux/local@latest
crux editor install vscode
# or: crux editor install cursor
```

Nightly users should install `@use-crux/local@nightly`; the installer selects
that exact nightly prerelease. To uninstall:

```bash
code --uninstall-extension use-crux.crux-vscode
cursor --uninstall-extension use-crux.crux-vscode
```

## Verify the installation

1. Confirm `crux --version` reports the version you installed.
2. Open a trusted workspace containing `crux.config.ts`, `.js`, or `.mjs`.
3. Open **Output: Crux** and confirm the matching language server started.
4. Save a TypeScript file containing a canonical Core `md` template. Markdown
   roles should appear outside `${...}` while expressions retain normal
   TypeScript behavior.
5. Place the cursor in that template and run **Crux: Preview PromptText
   Statically**. Start `crux dev` when you also want exact preview, Catalog, and
   captured-Run workflows.

## PromptText authoring

Crux decorates only templates whose saved semantic evidence resolves to the
canonical Core `md` identity. Aliases, namespace access, and resolvable local
re-exports work; shadowed, unrelated, ambiguous, unresolved, and type-only
bindings do not. Unsaved edits that make identity uncertain clear the
decorations instead of leaving stale styling.

All PromptText views derive from one bounded transient analysis for the current
document version:

- **Static preview** opens projected text beside the source. Unknown values are
  placeholders, and the document contains only bytes you can copy.
- **Exact preview** opens Devtools for an explicit runtime inspection. The
  application runtime owns validation and invocation; it does not create a
  model generation or ordinary Run.
- **Latest Run** opens previously captured evidence for the canonical owning
  definition, resolved when you click.

PromptText highlighting is additive and theme-aware. It does not replace the
editor's semantic-token provider, and interpolation expressions keep native
TypeScript completion, hover, definition, rename, diagnostics, bracket
matching, and selection.

## Project Index features

Crux also provides semantic completion and source-aware diagnostics,
navigation, symbols, hover, hints, and lenses for supported Crux definitions.
Most Project Index evidence is based on saved files. Completion is the narrow
exception: it uses a bounded request-only copy of the current document and
never writes unsaved text to Project Index caches or logs.

The extension discovers a trusted workspace-local `crux` installation first,
then `PATH`, unless `crux.binaryPath` is set. Use **Crux: Restart Language
Server** after replacing a binary in place.

## Support

- [VS Code and Cursor guide](https://cruxjs.dev/docs/developer-tools/vscode)
- [Editor and LSP reference](https://cruxjs.dev/docs/reference/lsp)
- [GitHub Releases](https://github.com/use-crux/crux/releases)
- [Repository](https://github.com/use-crux/crux)
- [Issues](https://github.com/use-crux/crux/issues)
- [Apache 2.0 license](https://www.apache.org/licenses/LICENSE-2.0)
