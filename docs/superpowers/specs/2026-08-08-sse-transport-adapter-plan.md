# SSE transport adapter — TDD implementation plan

Status: **ready to implement after design commit**

Specifications:

- [Design](./2026-08-08-sse-transport-adapter-design.md) (binding API, lowering, non-goals)
- [Managed stream design](./2026-08-07-managed-stream-transport-design.md) (parent seam #392)
- [Issue #340](https://github.com/use-crux/crux/issues/340) (parent acceptance; this PR is the thin SSE child only)
- Baseline on main: managed stream supervision (`stream({ open })`, Memory/Postgres checkpoints, stream fibers)

## Operating protocol

One PR (`feat/sse-transport-adapter`), multiple **coherent commits**. Each stage is red → green → refactor:

1. Add the smallest focused failing test(s).
2. Run only those tests; confirm red for the intended reason.
3. Add the minimum production code.
4. Re-run until green.
5. Refactor for file size (&lt;300 lines preferred, hard max 1000), braces on every `if`, blank lines between logical blocks, useful JSDoc on public/complex APIs.
6. Run the stage’s validation commands before the next stage.

Do **not**:

- Reimplement reconnect, lease, checkpoint, worker, or envelope accept kernels.
- Add WebSocket, post-accept ack, new stats/read models, fetch/EventSource, or credential storage in Core.
- Create a new changeset file or a major bump.
- Push from this plan phase (implementation sessions push only when the user asks).

Prefer fake `AsyncIterable`s over real sockets/network.

### Global validation helpers

```bash
# Focused vitest (from repo root)
pnpm --filter @use-crux/core exec vitest run <files>
pnpm --filter @use-crux/indexer exec vitest run <files>

# Package typecheck when types/public surface change
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/indexer typecheck

# Whitespace / conflict markers on staged diff
git diff --check
```

Run full package test suites only at stage gates noted below. Prefer sequential focused files during green loops.

### Suggested commit subject pattern

`feat(runtime): <stage summary>` for code; `docs(runtime): …` for docs-only; `feat(indexer): …` for indexer; changeset append rides with docs or last behavioral commit. First commit of this plan phase uses `docs(runtime): design SSE transport adapter`.

---

## Stage 0 — Authoring surface (`sse()` + union)

**Intent:** Public `sse({ open })` exists, freezes, and joins the transport union without Runtime lowering yet.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/sse-authoring.test.ts` | `sse({ open })` returns frozen `_tag: "SseTransport"`, `kind: "sse"`; missing `open` throws `TypeError`; definition does not invoke `open` at construction |
| `packages/core/__tests__/signal-provider-transport/provider-transport-validation.test.ts` (extend) | `signalProvider({ transport: sse(...) })` accepts; rejects non-transport; error text mentions `sse()` |
| `packages/core/__type_tests__/signal-sse-transport.type-test.ts` | `SignalProviderTransport` includes SSE; `isSseTransport` narrows; `isStreamTransport` is false for SSE; `isManagedStreamTransport` true for both stream and SSE |

### Production

- Add `packages/core/src/signal/transport/sse.ts` with types from the design and `sse()`.
- Export from `signal/transport/index.ts` (union + types).
- Update `signalProvider` validation / add `isSseTransport` / `isManagedStreamTransport`.
- JSDoc matching stream/polling quality; call out provider-ingress vs React SSE in module remarks.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/sse-authoring.test.ts \
  packages/core/__tests__/signal-provider-transport/provider-transport-validation.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): author sse() transport beside stream`

---

## Stage 1 — Pure lowering + lastEventId cursor contract

**Intent:** `SseItem` → `StreamItem` is pure, validated, and reuses canonical cursor rules.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/sse-lower.test.ts` | Envelope with `lastEventId` → envelope with `cursor`; omitted `lastEventId` → no cursor field; `null` lastEventId → `cursor: null`; cursor-only maps; oversized/control/empty lastEventId reject via canonical contract; batch/array reject; bad kind reject |

### Production

- `packages/core/src/signal/transport/sse-lower.ts`: `lowerSseItem`, `lowerSseOpen` (async generator wrap that yields lowered items; honors iterator return).
- Reuse `validateStreamItem` / `validateStreamCursor` rather than forking limits.
- Export pure helpers from transport barrel if they are part of the supported adapter-author surface; otherwise keep `@internal` and test via package path used by other transport helpers.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/sse-lower.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): lower SSE items to StreamItem`

---

## Stage 2 — HTTP status classification helpers

**Intent:** Adapters can map connect failures to terminal vs transient without Core owning HTTP clients.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/sse-http-status.test.ts` | 401/403/404/410 → terminal; 408/425/429/500/502/503 → transient; other 4xx terminal; codes match `SAFE` pattern / design table; helper pure (no network) |

### Production

- `packages/core/src/signal/transport/sse-http-status.ts`: `classifySseHttpStatus`, `sseHttpStatusErrorCode`.
- JSDoc table summary; point authors at `ManagedStreamTerminalError` for terminal throws.
- Re-export from transport index.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/sse-http-status.test.ts
git diff --check
```

### Commit

`feat(runtime): classify SSE HTTP connect failures`

---

## Stage 3 — Supervision boundary (lower into stream fiber)

**Intent:** Runtime worker supervises SSE providers through the existing stream fiber after lowering. No second reconnect loop.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/sse-supervision.test.ts` | (1) `signalProvider` + `sse({ open })` under Memory worker/supervision: one envelope with `lastEventId` → accepted record + checkpoint cursor equals that id + configRef active (2) cursor-only SSE item advances checkpoint without new envelope (3) `ManagedStreamTerminalError` from open → durable faulted, no reopen (4) clean EOF of finite iterable does not invent a second supervisor (reconnect may open again — assert via open call count ≥ 1 and existing stream behavior, keep events tiny) |

Reuse helpers from `stream-supervision-helpers.ts` / worker fixtures; only assert the **adapter boundary** plus one vertical tracer.

Optional single test file merge with a thin `sse-worker.test.ts` if supervision helpers require `createRuntimeWorker` for Signal drain — prefer one e2e tracer, not a second matrix.

### Production

- Extend `createWorkerTransportSupervision` filter: `isPollingTransport \|\| isManagedStreamTransport`.
- When `isSseTransport`, build `stream({ open: lowerSseOpen(transport.open) })` (or structural equivalent) and pass to existing `superviseStreamBinding` / `startStreamFiber`.
- Update capability error copy if it says “polling/stream” only (include SSE as managed stream).
- **Do not** edit `runManagedStream` reconnect logic except to accept transport if types force a shared interface — prefer keeping fiber on `StreamTransport` only.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/sse-supervision.test.ts \
  packages/core/__tests__/signal-provider-transport/stream-worker.test.ts \
  packages/core/__tests__/signal-provider-transport/stream-supervision.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): supervise sse() via managed stream fiber`

---

## Stage 4 — Project Index, lint, Catalog kind, cache epochs

**Intent:** Discover `sse()`, project `transportKind: "sse"`, reject live `open` on inert bindings (already covered), native/static parity.

### Tests (red)

| Area | Cases |
| --- | --- |
| Static facts | `sse({ open() {} })` → `transportKind: "sse"`, `hasOpen: true` |
| Provider nested transport | `signalProvider` with SSE transport kind |
| Lint | live `open` on `managedTransportBinding` still `signal.transportBinding.live_value` (existing; add SSE fixture if needed) |
| Native parity | same counts/kinds as static fixtures |
| Devtools adapt type / Catalog | `transportKind` accepts `"sse"`; Catalog row can render it (unit test on adapt types or existing catalog test fixture) |
| Epoch tests | update pinned epoch strings when bumped |

### Production

- `packages/core/src/project-index/signal-facts.ts` — add `"sse"`; document `hasOpen` for SSE.
- Indexer: `sse-static-facts.ts`, primitive manifest entry `signal.transport.sse`, `authoredTransportKind` includes `sse`, coverage identities JSON/fixtures.
- Devtools `adapt.ts` union includes `"sse"`.
- Bump `STATIC_PARSE_CACHE_EPOCH` / related epochs / Go snapshot **only when** required by AGENTS.md (unchanged source would otherwise reuse stale output).

### Validation

```bash
pnpm --filter @use-crux/indexer exec vitest run \
  packages/indexer/__tests__/signal-native-static.test.ts \
  packages/indexer/__tests__/signal-lint-contract.test.ts \
  packages/indexer/__tests__/signal-lint-native-parity.test.ts
# plus any new sse-specific files / first-party coverage gates
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/indexer typecheck
git diff --check
```

If Go epoch changed, run the same local/Go identity command used for the stream PR.

### Commit

`feat(indexer): discover sse() transport authoring`

---

## Stage 5 — Docs + architecture + changeset

**Intent:** Progressive docs; no behavior change.

### Content

| Target | Change |
| --- | --- |
| `apps/docs/content/docs/guides/durable-execution/signals/providers.mdx` | SSE row shipped; minimal path; link lifecycle to stream laws |
| `apps/docs/content/docs/guides/durable-execution/signals/provider-recipes.mdx` | SSE recipe; explicit “not `@use-crux/react` browser SSE” callout |
| `apps/docs/content/docs/reference/crux-core/signal/providers-and-transports.mdx` | Full `sse` reference, item table, lowering, HTTP classification, non-goals |
| `packages/core/src/signal/ARCHITECTURE.md` | SSE thin lowerer; stream fiber reuse; React distinction |
| `.changeset/reactive-durable-execution.md` | Append minor note for `sse({ open })` |

### Validation

```bash
git diff --check
ls .changeset/*.md
# Confirm no new changeset file; only reactive-durable-execution.md updated
# Docs package typecheck if available and cheap
```

### Commit

`docs(runtime): document SSE transport adapter`

---

## Stage 6 — Full gate (before PR ready)

Run broader suites **sequentially** to avoid OOM:

```bash
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/signal-provider-transport
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/indexer exec vitest run packages/indexer/__tests__/signal
pnpm --filter @use-crux/indexer typecheck
# Postgres stream suites should remain green without new SSE matrix:
pnpm --filter @use-crux/postgres exec vitest run \
  packages/postgres/__tests__/runtime-worker-stream.test.ts
git diff --check
```

Manual checklist against design:

- [ ] No second supervisor/reconnect/checkpoint/daemon
- [ ] No fetch/EventSource/parser in Core Runtime
- [ ] No WebSocket / ack API / new stats read model
- [ ] `lastEventId` validates through canonical cursor contract
- [ ] Pull backpressure only (serial lower + stream fiber)
- [ ] Stream lifecycle tests still green
- [ ] Docs distinguish provider-ingress SSE from React SSE
- [ ] Changeset updated, not duplicated; minor only
- [ ] No forbidden agent/tool names in branch/commits/content

---

## Suggested vertical commit order (summary)

1. `docs(runtime): design SSE transport adapter` ← **this phase**
2. `feat(runtime): author sse() transport beside stream`
3. `feat(runtime): lower SSE items to StreamItem`
4. `feat(runtime): classify SSE HTTP connect failures`
5. `feat(runtime): supervise sse() via managed stream fiber`
6. `feat(indexer): discover sse() transport authoring`
7. `docs(runtime): document SSE transport adapter` (+ changeset append if not done earlier)

Stages may be squashed if a vertical slice is tiny, but do not merge unrelated failures into one green attempt.

## Out of scope reminders for implementers

- Do not add `websocket()` in this PR.
- Do not freeze `ackToken` / `onEnvelopeAccepted`.
- Do not re-test the full stream reconnect exhaustion matrix for SSE.
- Do not store reconnect attempt history or SSE-specific durable fields.
- Do not put live headers/credentials on inert bindings or program JSON.
- Do not create a new changeset file; update `reactive-durable-execution.md`.
- Do not import or re-export `@use-crux/react` SSE helpers from Core.

## Implementation entrypoint for the next session

1. Read the design doc end-to-end (and skim the #392 stream design if reconnect semantics are unclear).
2. Start Stage 0 tests only.
3. Keep commits small and green.
4. Stop and report if a design conflict with main is discovered after another merge; update the design doc in-tree before inventing APIs.

## Decision blockers

**None.** Ready to implement after the design commit lands on this branch.
