# @crux/local

Local Crux runtime wrapper.

This npm package resolves and launches the platform-specific Go binary that provides:

- `crux dev`
- the local HTTP API and WebSocket/SSE subscriptions
- the embedded web devtools UI
- the TUI
- local SQLite-backed observability, quality, catalog, memory, workspace, and plan services
- bounded Node workers for source indexing, source lookup, and eval execution

The implementation lives in the monorepo under `packages/crux-cli` because it is a Go binary package. The public npm package name is `@crux/local`.

