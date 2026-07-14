# @use-crux/local

Local Crux runtime wrapper.

This npm package resolves and launches the platform-specific Go binary that provides:

- `crux dev`
- the local HTTP API and WebSocket/SSE subscriptions
- the embedded web devtools UI
- the TUI
- local SQLite-backed observability, quality, index, memory, workspace, and plan services
- bounded Node workers for source indexing, source lookup, and eval execution
- the Rust/Oxc Static Index worker used for native source parsing and Static Index acceleration

The implementation lives in the monorepo under `packages/local` because it is a Go binary package. The public npm package name is `@use-crux/local`.

## Install

```bash
# one-off, no install
npx @use-crux/local --help

# or install globally
npm i -g @use-crux/local
```

This package is a thin Node wrapper. On install it resolves the matching prebuilt binary from a platform package (`@use-crux/local-<os>-<cpu>`) and execs it, passing all arguments straight through. Each platform package ships both `bin/crux` and the sibling `bin/crux-static-index-worker` binary that `crux` discovers at runtime.

## Usage

```bash
crux dev        # start the local dev server, devtools UI, and TUI
crux check      # compile and gate Project Index health without a daemon
crux lint       # inspect Project Index lint findings without gating by default
crux --help     # list all commands
```

`crux check --json` writes one deterministic JSON v1 report and exits `0` for
a passing gate, `1` when selected findings meet `--fail-on`, or `2` when a
trustworthy compile could not complete. Both `check` and `lint` use the same
embedded Project Index service/worker pipeline as development.

## Supported platforms

Prebuilt binaries are published for:

| OS      | x64 | arm64 |
| ------- | --- | ----- |
| Linux   | ✅  | ✅    |
| macOS   | ✅  | ✅    |
| Windows | ✅  | ✅    |

On an unsupported `platform-arch` the wrapper exits with a clear error.
