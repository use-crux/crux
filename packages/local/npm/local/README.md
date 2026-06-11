# @crux/local

Local Crux runtime wrapper.

This npm package resolves and launches the platform-specific Go binary that provides:

- `crux dev`
- the local HTTP API and WebSocket/SSE subscriptions
- the embedded web devtools UI
- the TUI
- local SQLite-backed observability, quality, index, memory, workspace, and plan services
- bounded Node workers for source indexing, source lookup, and eval execution

The implementation lives in the monorepo under `packages/local` because it is a Go binary package. The public npm package name is `@crux/local`.

## Install

```bash
# one-off, no install
npx @crux/local --help

# or install globally
npm i -g @crux/local
```

This package is a thin Node wrapper. On install it resolves the matching prebuilt binary from a platform package (`@crux/local-<os>-<cpu>`) and execs it, passing all arguments straight through.

## Usage

```bash
crux dev        # start the local dev server, devtools UI, and TUI
crux --help     # list all commands
```

## Supported platforms

Prebuilt binaries are published for:

| OS      | x64 | arm64 |
| ------- | --- | ----- |
| Linux   | ✅  | ✅    |
| macOS   | ✅  | ✅    |
| Windows | ✅  | ✅    |

On an unsupported `platform-arch` the wrapper exits with a clear error.
