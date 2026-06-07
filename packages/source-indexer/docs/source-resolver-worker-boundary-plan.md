# Source Resolver Worker Boundary Plan

Status: implemented
Issue: https://github.com/use-crux/crux/issues/19
Owner: source-indexer / devtools worker boundary
Last updated: 2026-06-06

## Purpose

This is the durable execution plan for hardening the source resolver worker boundary. Keep this file up to date while implementing the work so progress survives context compaction, interrupted sessions, and handoffs.

The source resolver worker should remain a separate lazy runtime worker. It is adjacent to Project Catalog indexing, but it owns a different concern:

- Project Catalog indexing builds ahead-of-time source intelligence for a project.
- Source resolver lookup maps runtime bundled trace locations back to original source through source maps, and can extract readable original function source on demand.

The implementation should preserve the existing public entry point:

```ts
import { SourceResolver } from '@crux/source-indexer/source-resolver'
```

The worker bundle should also remain:

```text
packages/devtools/bin/source-resolver.ts -> dist/source-resolver.mjs
```

## Current Evidence

The resolver is still a live runtime path:

- `packages/source-indexer/source-resolver.ts` exports `SourceResolver`.
- `packages/devtools/bin/source-resolver.ts` wraps it as a stdio JSON-line worker.
- `packages/local/internal/server/http.go` exposes `POST /api/resolve-source` and `POST /api/resolve-fn-source`.
- `packages/devtools/ui/src/shared/services/sourceResolver.ts` calls those endpoints.
- `packages/devtools/ui/src/shared/hooks/useResolvedSource.ts` provides UI hooks for resolved trace/source display.
- `packages/devtools/README.md` documents `source-resolver.mjs` separately from `project-indexer.mjs`.

The current issue is not that the worker is obsolete. The issue is that important behavior is concentrated in a small number of broad files with weak boundaries and little focused test coverage.

## Goals

- Keep `SourceResolver` as the package entry point for devtools worker use.
- Split source resolver internals into focused, documented, mostly pure functional modules.
- Add behavior-first tests using a red-green-refactor loop.
- Use TypeScript type guards, discriminated unions, readonly data, and `unknown` narrowing instead of explicit `any`.
- Make the worker protocol JSON-line safe.
- Document cache limits, source map fallback behavior, and the relationship between the resolver and Project Catalog indexing.
- Keep behavior stable unless a test exposes an existing bug that should be intentionally fixed.

## Non-Goals

- Do not remove `source-resolver.mjs`.
- Do not merge source resolution into `project-indexer.mjs`.
- Do not turn the catalog indexer into a runtime source-map resolver.
- Do not rewrite the devtools UI.
- Do not change public HTTP endpoint names unless a later explicit decision records why.
- Do not introduce a broad validation dependency unless local patterns show it is already preferred here.

## Design Principles

### TDD

Use vertical TDD slices. Do not write all tests first and then implement all code. Each implementation slice should follow:

1. Add one behavior test through the most public practical interface.
2. Confirm it fails for the expected reason.
3. Write the minimum implementation or extraction to pass.
4. Refactor only while green.
5. Update this plan before moving to the next slice.

### Pure Functional Core

The desired shape is a small mutable shell around a pure functional core.

`SourceResolver` may retain stateful caches because it is the compatibility facade used by the worker. Internals should prefer pure functions:

- inputs are explicit
- filesystem and source-map effects are passed through dependency objects
- outcomes are returned as typed values
- cache updates are modeled as transitions where practical
- functions do not write logs or process output

### Type Safety

Use advanced TypeScript patterns only where they clarify correctness:

- discriminated unions for protocol, cache, and resolution outcomes
- readonly object and array types for inputs/results
- `unknown` plus type guards for JSON parsing
- branded/template literal cache keys if they reduce accidental key mixing
- exhaustiveness checks for worker method handling
- no explicit `any`

Avoid type machinery that makes normal maintenance harder.

### Documentation

Every exported type and function in new source resolver modules should have JSDoc.

JSDoc should explain:

- whether the function is pure
- what fallback order it uses
- whether failures are returned or thrown
- whether paths refer to bundled files or original source files
- which behavior is part of the worker compatibility contract

## Target File Structure

The current source resolver should be split from one broad module into this organized structure:

```text
packages/source-indexer/
  source-resolver.ts
  source-resolver/
    cache.ts
    discovery.ts
    extraction.ts
    filesystem.ts
    index.ts
    original-source.ts
    protocol.ts
    resolver.ts
    trace-map.ts
    types.ts
  __tests__/
    source-resolver.test.ts
    source-resolver-cache.test.ts
    source-resolver-discovery.test.ts
    source-resolver-extraction.test.ts
    source-resolver-protocol.test.ts
    source-resolver-trace-map.test.ts
```

Responsibilities:

- `source-resolver.ts`: stable package entry point, re-exporting or wrapping the organized module.
- `source-resolver/index.ts`: organized module barrel for internal worker use.
- `source-resolver/types.ts`: public and internal resolver types.
- `source-resolver/filesystem.ts`: small filesystem dependency interface plus Node implementation.
- `source-resolver/cache.ts`: cache key construction, limits, and cache transition helpers.
- `source-resolver/discovery.ts`: source map sidecar, relative URL, and inline data URI discovery.
- `source-resolver/trace-map.ts`: trace-map parsing and original-position lookup.
- `source-resolver/original-source.ts`: `sourcesContent` lookup and disk fallback.
- `source-resolver/extraction.ts`: pure function body extraction.
- `source-resolver/protocol.ts`: worker request parsing and response serialization.
- `source-resolver/resolver.ts`: orchestration functions plus the `SourceResolver` facade.

The files above should stay small and purpose-specific. If one grows large during execution, split it again around a named responsibility.

## Proposed Types

These are directional shapes, not a mandate to copy exactly.

```ts
export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column?: number
  readonly function?: string
}

export interface ResolvedLocation extends SourceLocation {
  readonly resolved: boolean
}

export interface ResolvedFnSource {
  readonly source: string
  readonly file: string
  readonly startLine: number
  readonly resolved: true
}

export type SourceMapDiscoveryResult =
  | { readonly kind: 'found'; readonly mapJson: string; readonly source: 'sidecar' | 'inline' | 'relative-url' }
  | { readonly kind: 'not-found'; readonly reason: SourceMapDiscoveryFailure }

export type SourceMapDiscoveryFailure =
  | 'bundle-not-readable'
  | 'sidecar-not-readable'
  | 'mapping-url-missing'
  | 'inline-map-invalid'
  | 'relative-map-not-readable'

export type TraceMapResolutionResult =
  | {
      readonly kind: 'resolved'
      readonly file: string
      readonly line: number
      readonly column?: number
      readonly name?: string
    }
  | { readonly kind: 'unresolved'; readonly reason: TraceMapResolutionFailure }

export type TraceMapResolutionFailure =
  | 'source-map-missing'
  | 'source-map-invalid'
  | 'original-source-missing'
  | 'original-line-missing'

export type SourceResolverWorkerRequest =
  | { readonly method: 'resolveLocations'; readonly locations: readonly SourceLocation[] }
  | { readonly method: 'resolveFnSource'; readonly file: string; readonly line: number; readonly column?: number }

export type SourceResolverWorkerResponse =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }
```

Important compatibility note: the current HTTP/UI service expects the existing result payloads. The protocol may use richer internal unions, but the worker output should remain compatible unless a migration is explicitly planned.

## Execution Checklist

Update this checklist as work progresses.

### Phase 0: Orientation

- [x] Confirm current dirty worktree and avoid overwriting unrelated user changes.
- [x] Re-read `packages/source-indexer/source-resolver.ts`.
- [x] Re-read `packages/devtools/bin/source-resolver.ts`.
- [x] Re-read `packages/local/internal/server/sourceworker.go`.
- [x] Re-read the UI source resolver service and hooks.
- [x] Confirm whether existing uncommitted files already touch this area.

### Phase 1: Characterization Tracer Bullet

- [x] Add `packages/source-indexer/__tests__/source-resolver.test.ts`.
- [x] Write one public `SourceResolver` test proving sidecar source-map resolution works.
- [x] Run focused test.
- [x] Implement the minimum harness or fixture needed for green without restructuring.
- [x] Run focused test green.
- [x] Update this plan with notes from the tracer bullet.

Behavior to prove:

- Given a bundled file and sidecar `.map`, `resolveLocation` returns the original file, line, column, optional function name, and `resolved: true`.

### Phase 2: Function Body Extraction

- [x] Add `packages/source-indexer/__tests__/source-resolver-extraction.test.ts`.
- [x] Write extraction behavior tests.
- [x] Extract `extractFunctionBody` to `source-resolver/extraction.ts`.
- [x] Add JSDoc to extraction exports.
- [x] Add behavior cases:
  - [x] function declaration
  - [x] arrow function with block body
  - [x] arrow function with expression body
  - [x] nested braces
  - [x] template literal with interpolation
  - [x] max-line cutoff
- [x] Keep `SourceResolver.resolveFnSource` behavior green after extraction.

### Phase 3: Source Map Discovery

- [x] Add `packages/source-indexer/__tests__/source-resolver-discovery.test.ts`.
- [x] Create `source-resolver/filesystem.ts` with a documented filesystem dependency interface.
- [x] Create `source-resolver/discovery.ts`.
- [x] Move sidecar `.map` discovery behind a pure function with injected filesystem effects.
- [x] Add behavior cases:
  - [x] sidecar map is preferred
  - [x] relative `sourceMappingURL` is resolved from bundle directory
  - [x] inline base64 data URI is decoded
  - [x] missing bundle returns a typed not-found result
  - [x] invalid inline data URI returns a typed not-found result
  - [x] unreadable map returns a typed not-found result
- [x] Ensure no resolver behavior changes except improved typing.

### Phase 4: Trace Map Resolution

- [x] Add `packages/source-indexer/__tests__/source-resolver-trace-map.test.ts`.
- [x] Create `source-resolver/trace-map.ts`.
- [x] Move `TraceMap` construction and `originalPositionFor` lookup into typed helpers.
- [x] Add JSDoc for parse and lookup functions.
- [x] Add behavior cases:
  - [x] valid mapping resolves original location
  - [x] missing source returns unresolved
  - [ ] missing original line returns unresolved
  - [x] invalid map JSON returns null instead of throwing through the worker
- [x] Confirm `resolveLocation` still returns the existing compatibility shape.

### Phase 5: Original Source Loading

- [x] Add focused tests in `source-resolver-original-source.test.ts`.
- [x] Create `source-resolver/original-source.ts`.
- [x] Prefer `sourcesContent` when present.
- [x] Fall back to disk using normalized original path resolution.
- [x] Return `null` instead of throwing for unavailable source.
- [x] Document fallback order in JSDoc and README/architecture docs.

### Phase 6: Cache Policy

- [x] Add `packages/source-indexer/__tests__/source-resolver-cache.test.ts`.
- [x] Create `source-resolver/cache.ts`.
- [x] Move cache limits and cache key construction into documented helpers.
- [x] Remove the previously unused bundled file content cache during the split.
- [x] Test location cache hit behavior through the facade.
- [x] Test oldest-entry eviction after the max size.
- [x] Test sourcemap cache stores misses as well as hits.
- [x] Document cache limits in JSDoc and architecture docs.

### Phase 7: Resolver Facade

- [x] Create `source-resolver/resolver.ts`.
- [x] Move orchestration into the organized module.
- [x] Keep `SourceResolver` public methods:
  - [x] `resolveLocation`
  - [x] `resolveFnSource`
  - [x] `resolveStack`
- [x] Keep `packages/source-indexer/source-resolver.ts` as the stable export file.
- [x] Ensure JSDoc exists on public facade methods.
- [ ] Run all `@crux/source-indexer` tests.
- [x] Run `@crux/source-indexer` typecheck.

### Phase 8: Worker Protocol

- [x] Add `packages/source-indexer/__tests__/source-resolver-protocol.test.ts`.
- [x] Create `source-resolver/protocol.ts`.
- [x] Implement `parseSourceResolverWorkerRequest(line: string)` with `unknown` plus type guards.
- [x] Implement response helpers that always serialize to one JSON line.
- [x] Reject malformed JSON with a JSON-safe error response.
- [x] Reject unknown method with a JSON-safe error response.
- [x] Reject invalid payload shape with a JSON-safe error response.
- [x] Ensure thrown resolver errors become JSON-safe error responses.
- [x] Update `packages/devtools/bin/source-resolver.ts` to delegate protocol parsing/serialization.
- [x] Keep stdout limited to protocol responses.
- [x] Keep logs on stderr only.

### Phase 9: Go Worker Boundary

- [x] Add or update `packages/local/internal/server/sourceworker_test.go`.
- [x] Compare `SourceWorker` behavior with `ProjectIndexWorker` scanner/read handling.
- [x] Adopt a bounded line reader similar to project index worker.
- [x] Test worker stdout close handling.
- [x] Test malformed JSON response handling.
- [x] Test scanner/reader error handling.
- [x] Keep HTTP endpoint compatibility.

### Phase 10: Documentation

- [x] Update `packages/source-indexer/README.md`.
- [x] Update `packages/source-indexer/ARCHITECTURE.md`.
- [x] Update `packages/devtools/README.md`.
- [x] Document why `source-resolver.mjs` and `project-indexer.mjs` both exist.
- [x] Document module layout.
- [x] Document worker protocol.
- [x] Document cache and fallback behavior.
- [x] Document validation commands.

### Phase 11: Final Validation

Run from `crux/`:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm --filter @crux/source-indexer test -- --run
pnpm --filter @crux/source-indexer typecheck
pnpm --filter @crux/devtools build:workers
cd packages/local
go test ./internal/server/...
```

If worker bundles are changed and intended to be embedded:

```bash
cd packages/cli
make embed
make build
```

Only update embedded generated files if that is part of the intended change scope.

## Resumption Protocol

When resuming work:

1. Read this file first.
2. Check `git status --short` in both the Karyla root and `crux/`.
3. Identify the first unchecked item in the execution checklist.
4. Inspect any touched files before editing.
5. Continue one TDD vertical slice at a time.
6. Update this file after each completed phase or if the plan changes.

## Open Decisions

- Should worker protocol responses remain exactly `{ locations }`, function source object, or `{ error }`, or should internal protocol unions be adapted only inside the worker wrapper?
  - Current recommendation: preserve external payload compatibility and use richer unions internally.
- Should `SourceWorker` use the same bounded reader pattern as `ProjectIndexWorker`?
  - Resolved: yes. `SourceWorker` now uses a bounded reader helper with focused tests.
- Should the currently unused `fileContentCache` in `SourceResolver` be removed?
  - Resolved: removed during the module split because it was unused.
- Should source resolver modules be exported as public subpaths?
  - Current recommendation: no. Keep them internal unless another package needs them.

## Progress Log

- 2026-06-06: Confirmed the source resolver worker is still needed. It serves runtime source-map and function-source lookup, while Project Catalog indexing serves ahead-of-time project intelligence.
- 2026-06-06: Created this durable plan. No source code has been refactored yet.
- 2026-06-06: Split `source-resolver.ts` into focused modules under `source-resolver/`, added focused tests for discovery, extraction, trace-map lookup, original-source loading, cache policy, protocol parsing, and the public facade, and updated the devtools worker wrapper to use JSON-line-safe protocol helpers.
- 2026-06-06: Validation passed for focused source-resolver tests, `@crux/source-indexer` typecheck, and `@crux/devtools build:workers`. Full source-indexer suite is not currently clean because an unrelated in-progress incremental executor test failed before this change.
- 2026-06-06: Finished Go-side source worker hardening. `SourceWorker` now uses a bounded reader helper, resets the worker on read failures, propagates worker `{ error }` envelopes, and has focused tests for missing stdout, oversized responses, captured reader behavior, malformed JSON responses, and worker error responses. `go test ./internal/server/...` passed.
