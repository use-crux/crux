# @crux/devtools

React web devtools for `@crux/core` — inspect prompts, contexts, execution traces, evals, quality experiments, index intelligence, and lint findings.

## Architecture

The Go runtime in `@crux/local` owns the HTTP API, WebSocket/SSE subscriptions, SQLite services, TUI, and static UI hosting. This package owns the React UI source and the bounded Node worker entrypoints that are embedded into the Go binary.

```
crux binary (Go)
  ├── go:embed React UI assets         → served by Go
  ├── go:embed project-indexer.mjs     → bounded Node worker using @crux/indexer
  ├── go:embed project-semantic-indexer.mjs → bounded Node semantic worker
  ├── go:embed project-runtime-indexer.mjs  → bounded Node runtime worker
  ├── go:embed quality-runner.mjs      → bounded Node quality worker
  └── go:embed source-resolver.mjs     → lazy source lookup worker

crux-indexer-worker (Rust/Oxc)
  └── packaged beside the Go binary for Static Index acceleration
```

The Go runtime spawns Node only for helper workers that need to import project TypeScript. `tsx` is resolved from the project's `node_modules`.

`project-indexer.mjs` and `source-resolver.mjs` are intentionally separate workers. The project indexer builds Project Index facts ahead of time. The source resolver is a lazy lookup worker for runtime trace locations: it discovers source maps, resolves bundled file/line/column positions to original source, and extracts function previews for trace detail UI.

### Project Index Read Model

The Project Index snapshot produced by the worker is stored raw in the Go runtime. Derived devtools
fields are added by `@crux/local/internal/indexread`, not by the worker, store, or React UI. The
read-model pipeline joins in-memory eval/RAG/flow runs, file-backed `.crux/quality` records,
source mtime metadata, and safety target metadata into the `definition.quality` view served over
HTTP and websocket snapshots.

Callers that write caches or merge runtime snapshots should use the raw store index. Callers that
serve devtools should use the `indexread.Model.Index()` path wired through `devtools.Service`.

## Build & Embed Pipeline

The full pipeline from source to running CLI:

```
1. pnpm --filter @crux/devtools build
   └── esbuild bundles bin/quality-runner.ts           → dist/quality-runner.mjs
   └── esbuild bundles bin/source-resolver.ts          → dist/source-resolver.mjs
   └── esbuild bundles bin/project-indexer.ts          → dist/project-indexer.mjs
   └── esbuild bundles bin/project-semantic-indexer.ts → dist/project-semantic-indexer.mjs
   └── esbuild bundles bin/project-runtime-indexer.ts  → dist/project-runtime-indexer.mjs
   └── Vite builds ui/dist

2. make local
   └── make embed: copies dist/*.mjs and ui/dist into packages/local/internal/assets
   └── cargo build: compiles the current-platform crux-indexer-worker
   └── go build: compiles Go binary with go:embed files

3. User runs: pnpm crux dev (or crux quality run)
   └── node_modules/.bin/crux resolves the @crux/local Go binary
   └── Go serves the UI and APIs directly
   └── Go spawns Node helper workers only when indexing, resolving source, or running Quality
```

### Step 1: Build the bundles

```bash
pnpm --filter @crux/devtools build:workers
```

Produces self-contained ESM worker bundles in `dist/`:

- `quality-runner.mjs` — Quality execution runner (all deps bundled)
- `source-resolver.mjs` — source lookup worker
- `project-indexer.mjs` — Project Index indexing worker backed by `@crux/indexer`
- `project-semantic-indexer.mjs` — semantic Project Index worker backed by `@crux/indexer`
- `project-runtime-indexer.mjs` — runtime Project Index worker backed by `@crux/indexer`

The worker bundles only depend on Node.js builtins. The build script is `scripts/build-workers.mjs` (esbuild, ESM format, target node24).

The source resolver worker speaks one JSON request per stdin line and writes one JSON response per stdout line. Protocol parsing lives in `@crux/indexer/source-resolver` so malformed requests become JSON-safe `{ "error": "..." }` responses and logs stay on stderr.

### Step 2: Build the Go CLI

```bash
make local    # copies dist/*.mjs into embed dirs, builds Rust worker, then builds Go
```

`make embed` copies the bundles into `packages/local/internal/assets/embed/` and the UI into `packages/local/internal/assets/ui-embed/`. Then `go build` compiles the binary with Go's `//go:embed` directive, embedding the assets directly in the binary. `cargo build` also produces the current-platform `crux-indexer-worker` so the Go runtime can discover it beside the `crux` executable.

### Step 3: How the CLI runs

When a user runs `pnpm crux dev` or `pnpm crux quality run`:

1. **`@crux/local` wrapper** resolves the Go binary via:
   - `@crux/local-{platform}-{arch}` npm package (production)
   - `packages/local/crux` (monorepo development)
2. **Go binary** extracts embedded `.mjs` to `~/.cache/crux/` (hash-named for cache invalidation)
3. **Go binary** discovers `crux-indexer-worker` beside the `crux` executable, unless `CRUX_STATIC_INDEX_WORKER` points at an explicit worker path
4. **Go binary** spawns Node helpers as needed: `node --import tsx/esm <extracted.mjs> [args]`
   - `--import tsx/esm` registers the TypeScript ESM loader so `.ts` config/eval files can be imported
   - `cmd.Dir` is set to the project root (so `tsx` resolves from project's `node_modules`)

### When to rebuild

- **Changed worker code** (`bin/`, `lib/`, `scripts/`): rebuild bundles (step 1) + rebuild local runtime (step 2)
- **Changed Go local code** (`packages/local/internal/`, `packages/local/cmd/`): run `make local-go` if embedded assets are current, otherwise `make local`
- **Changed Rust/Oxc worker code** (`crates/`): run `make local`
- **Changed only TypeScript source** (not bundled): no rebuild needed — `.ts` files are imported at runtime

## Environment Variables

The Go CLI sets these when spawning the server:

| Variable           | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `PORT`             | Server port (default 4400)                                         |
| `CRUX_STATIC_DIR`  | Path to pre-built dashboard UI (`ui/dist`). Auto-resolved by CLI.  |
| `CRUX_PROJECT_DIR` | Project root for resolving optional peer deps via `createRequire`. |
| `CRUX_CACHE_DIR`   | Override cache directory (default: `~/.cache/crux/`).              |

## Gotchas

### CRLF line endings (WSL)

If `git config core.autocrlf` is `true` (common on WSL), git adds `\r` to shebangs in `.cjs`/`.mjs` files, causing `"/usr/bin/env: 'node\r': No such file or directory"`. The root `.gitattributes` forces LF on `*.mjs`, `*.cjs`, and `*.sh` to prevent this.

### Cross-platform builds

Run the build from the same environment that installed `node_modules`.

- If dependencies were installed inside WSL/Linux, run the build and CLI there too.
- If dependencies were installed on Windows, run the build and CLI from Windows.

Mixing Windows tooling with WSL-installed native dependencies can break `esbuild` startup.
