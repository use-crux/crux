# Managed async-stream transport supervision — TDD implementation plan

Status: **ready to implement after design commit**

Specifications:

- [Design](./2026-08-07-managed-stream-transport-design.md) (binding types, lifecycle, non-goals)
- [Issue #340](https://github.com/use-crux/crux/issues/340) (parent acceptance; this PR is the generic stream seam only)
- Baseline: polling supervision already on main (`worker-transport-poll*.ts`, Memory/Postgres checkpoints)

## Operating protocol

One PR (`feat/managed-stream-transport`), multiple **coherent commits**. Each stage is red → green → refactor:

1. Add the smallest focused failing test(s).
2. Run only those tests; confirm red for the intended reason.
3. Add the minimum production code.
4. Re-run until green.
5. Refactor for file size (&lt;300 lines preferred, hard max 1000), braces, blank lines, JSDoc on public/complex APIs.
6. Run the stage’s validation commands before the next stage.

Do **not** implement SSE/WebSocket adapters, a second worker, daemon, store, scheduler, registry, or provider SDK dependency in core.

Prefer fake `AsyncIterable`s over real sockets/network.

### Global validation helpers

```bash
# Focused vitest (from repo root)
pnpm --filter @use-crux/core exec vitest run <files>
pnpm --filter @use-crux/postgres exec vitest run <files>
pnpm --filter @use-crux/indexer exec vitest run <files>

# Package typecheck when types/public surface change
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/postgres typecheck
pnpm --filter @use-crux/indexer typecheck

# Whitespace / conflict markers on staged diff
git diff --check
```

Run full package test suites only at stage gates noted below (avoid OOM from unbounded parallel matrices). Prefer sequential focused files during green loops.

### Suggested commit subject pattern

`feat(runtime): <stage summary>` for code; `docs(runtime): …` for docs-only; final docs/changeset may be `docs(runtime): document managed stream supervision` and changeset update can ride with the last behavioral commit or a dedicated `chore(changeset): …` if preferred. First commit of this plan phase already uses `docs(runtime): design managed stream supervision`.

---

## Stage 0 — Authoring surface (types + `stream()`)

**Intent:** Public `stream({ open })` exists, freezes, and joins the transport union without Runtime supervision yet.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/stream-authoring.test.ts` | `stream({ open })` returns frozen `_tag: "StreamTransport"`, `kind: "stream"`; missing `open` throws `TypeError`; definition does not invoke `open` at construction |
| `packages/core/__tests__/signal-provider-transport/provider-transport-validation.test.ts` (extend) | `signalProvider({ transport: stream(...) })` accepts; rejects non-transport |
| `packages/core/__type_tests__/signal-stream-transport.type-test.ts` (or extend existing transport type tests) | `SignalProviderTransport` includes stream; `isStreamTransport` narrows |

### Production

- Add `packages/core/src/signal/transport/stream.ts` with types from the design and `stream()`.
- Export from `signal/transport/index.ts`.
- Update `signalProvider` / `isSignalProviderTransport` / add `isStreamTransport`.
- JSDoc on public types matching webhook/polling quality.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-authoring.test.ts \
  packages/core/__tests__/signal-provider-transport/provider-transport-validation.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): author stream() transport beside polling`

---

## Stage 1 — Terminal error + item/cursor contract helpers

**Intent:** Pure classification and validation used by the fiber, testable without stores.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/stream-contract.test.ts` | Accept envelope + cursor-only shapes; reject missing `kind`, bad cursor bytes/controls, oversized cursor; classify `ManagedStreamTerminalError` and duck-typed `{ terminal: true, code }`; unsafe codes → `TRANSPORT_STREAM_TERMINAL`; AbortError not terminal |

### Production

- `packages/core/src/runtime/transport/stream-errors.ts` — `ManagedStreamTerminalError`, `isManagedStreamTerminalError`, safe code helper (share pattern with poll `errorCode`).
- Pure `validateStreamItem` / cursor helpers (either in `stream.ts` private or `runtime/transport/stream-item.ts` if shared with worker). Prefer keeping authoring module free of Runtime store imports; put Runtime-facing validation next to the worker/fiber.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-contract.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): classify managed stream terminal failures`

---

## Stage 2 — Checkpoint record: configRef + status

**Intent:** Durable checkpoint can store config identity and `active|faulted|disabled` without breaking polling.

### Tests (red)

| File | Cases |
| --- | --- |
| Memory transport / binding checkpoint tests (extend existing polling hardening or new `binding-checkpoint-stream-fields.test.ts`) | put/get round-trip `configRef` + `status`; omitted fields decode as today; lease fence still rejects stale token |
| Postgres: extend `runtime-worker-polling.test.ts` fence cases or add `runtime-binding-checkpoint-status.test.ts` | DDL columns present; encode/decode; fence unchanged |

### Production

- Extend `RuntimeTransportBindingCheckpoint` in `binding-checkpoint.ts`.
- Memory `putBindingCheckpoint` / get encode new fields.
- Postgres DDL `ADD COLUMN IF NOT EXISTS` for `config_ref_id`, `config_ref_revision`, `status`; required-columns list; SQL insert/update/decode.
- Export types from `runtime/transport/index.ts` / public if needed.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/polling-supervision-hardening.test.ts \
  packages/core/__tests__/signal-provider-transport/binding-checkpoint-stream-fields.test.ts
# if postgres tests added:
pnpm --filter @use-crux/postgres exec vitest run \
  packages/postgres/__tests__/runtime-worker-polling.test.ts
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/postgres typecheck
git diff --check
```

### Commit

`feat(runtime): persist transport checkpoint config and status`

---

## Stage 3 — Stream fiber: accept + checkpoint (single connection)

**Intent:** Given a lease and fake iterable, accept envelopes and checkpoint with configRef serially.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/core/__tests__/signal-provider-transport/stream-supervision.test.ts` | (1) envelope with cursor → accepted record + checkpoint cursor+configRef+active (2) envelope without cursor → accept, cursor unchanged (3) cursor-only → checkpoint without new envelope (4) accept then fail before cursor checkpoint on later item → prior checkpoint retained (5) contract-invalid item → no bad checkpoint advance |

Use helpers modeled on `polling-supervision-helpers.ts` (`createStreamFixture`).

Drive the fiber function **directly** first (export testable `runStreamConnection` / similar), not necessarily full worker.

### Production

- `worker-transport-stream.ts`: open → iterate → map envelope → `acceptTransportEnvelope` → conflict evidence path (copy polling semantics) → `putBindingCheckpoint` with lease fence + configRef.
- Lease-bound abort signal (share/adapt `worker-transport-poll-signal.ts`).
- On terminal error: write status faulted, keep cursor, stop.
- Do not implement reconnect loop yet (single connection until EOF/error).

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-supervision.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): accept stream items under lease-fenced checkpoints`

---

## Stage 4 — EOF reconnect, transient backoff, exhaustion

**Intent:** Clean EOF and transient errors reconnect from durable cursor; exhaustion becomes durable faulted.

### Tests (red)

| File | Cases |
| --- | --- |
| Extend `stream-supervision.test.ts` or `stream-reconnect.test.ts` | Clean EOF → second `open` with durable cursor; transient throw → backoff then reopen (inject clock/rng); consecutive failures hit `MAX_STREAM_TRANSIENT_FAILURES` → status faulted + `TRANSPORT_STREAM_EXHAUSTED`; success resets failure counter; AbortError does not count as transient failure |

### Production

- Reconnect loop in stream fiber with process-local attempt/delay.
- Use `retryDelayMs` with stream max backoff constant (60s).
- Injectable clock/rng for tests via internal options only.
- Durable fault write path for exhaustion and terminal.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-reconnect.test.ts \
  packages/core/__tests__/signal-provider-transport/stream-supervision.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): reconnect managed streams with bounded backoff`

---

## Stage 5 — Config invalidation + durable skip

**Intent:** configRef change over-invalidates cursor; faulted/disabled skip open.

### Tests (red)

| Cases | |
| --- | --- |
| Checkpoint under `rev.1`, binding `rev.2` | open receives `cursor: null`; does not inherit faulted from old config |
| Durable `faulted` under same config | supervision does not call `open` |
| Durable `disabled` under same config | same skip |
| Operator/test clears status to active | open resumes from stored cursor |

### Production

- Effective cursor/status resolution helper used before open
  (`resolveStreamCheckpoint`: configRef id+revision equality; over-invalidate
  cursor + non-active status on mismatch).
- Supervision skip path without claiming lease when non-active (per design).
  **Ordering correction/clarification:** unfenced `getBindingCheckpoint` + no
  write on skip means pre-claim skip is lease-safe with the existing store;
  keep all status/cursor writes lease-fenced after claim. Do not add a second
  store or lease.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-config-status.test.ts
git diff --check
```

### Commit

`feat(runtime): invalidate stream cursors on config change`

---

## Stage 6 — Supervision runner + worker integration

**Intent:** One worker tick manages leases/fibers; drain still normalizes; stop aborts streams.

### Tests (red)

| File | Cases |
| --- | --- |
| `stream-worker.test.ts` | `createRuntimeWorker` with stream provider publishes Signal via existing drain; stop aborts in-flight open/iteration (signal aborted); dispose releases lease |
| Competing workers (Memory) | second supervisor does not open while first holds lease |
| Restart | first worker accepts+checkpoints, stop; second worker opens with durable cursor; no duplicate Signal occurrence for same event |

Keep event counts tiny (1–3 items).

### Production

- Extend `createWorkerTransportSupervision` to include stream bindings, own fiber map, bounded `runOnce`, dispose cancels fibers.
- Wire counters into `TransportSupervisionRunResult` additively.
- Update `create-runtime-worker.ts` JSDoc only if behavior text mentions polling alone.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-worker.test.ts \
  packages/core/__tests__/signal-provider-transport/stream-supervision.test.ts
# Ensure polling still green:
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/polling-supervision.test.ts \
  packages/core/__tests__/signal-provider-transport/polling-supervision-hardening.test.ts
pnpm --filter @use-crux/core typecheck
git diff --check
```

### Commit

`feat(runtime): supervise stream bindings on the Runtime worker`

---

## Stage 7 — Crash between accept and checkpoint

**Intent:** Prove redelivery + dedupe.

### Tests (red)

| Case | |
| --- | --- |
| Inject failure after `accept` succeeds and before `putBindingCheckpoint` | envelope durable; cursor not advanced; reconnect yields same `eventId`; accept returns duplicate; Signal occurrence id stable after normalize |

### Production

- Ensure fiber ordering never checkpoints before accept resolves; test harness may wrap store port.

### Validation

```bash
pnpm --filter @use-crux/core exec vitest run \
  packages/core/__tests__/signal-provider-transport/stream-redelivery.test.ts
git diff --check
```

### Commit

`test(runtime): prove stream accept/checkpoint redelivery`

(If a tiny production guard is needed, use `fix(runtime): …` instead.)

---

## Stage 8 — PostgreSQL conformance + multi-worker

**Intent:** Durable path matches Memory laws.

### Tests (red)

| File | Cases |
| --- | --- |
| `packages/postgres/__tests__/runtime-worker-stream.test.ts` | worker open/accept/checkpoint/restart; lease fence rejects stale put; two workers / two stores against one DB — only one opens (pattern after `runtime-worker-polling.test.ts`) |

Share fixture builders if useful; keep postgres tests sequential-friendly.

### Production

- Finish any remaining Postgres encode paths for stream checkpoint fields.
- No Convex requirement for stream checkpoints unless the adapter already implements binding checkpoints; if Convex lacks checkpoint methods, stream supervision already fails capability preflight like polling — document, do not invent partial Convex stream support.

### Validation

```bash
pnpm --filter @use-crux/postgres exec vitest run \
  packages/postgres/__tests__/runtime-worker-stream.test.ts \
  packages/postgres/__tests__/runtime-worker-polling.test.ts
pnpm --filter @use-crux/postgres typecheck
git diff --check
```

### Commit

`feat(postgres): durable managed stream supervision`

---

## Stage 9 — Project Index, lint, cache epochs

**Intent:** Discover `stream()`, reject live `open` on inert bindings, parity.

### Tests (red)

| Area | Cases |
| --- | --- |
| Static facts | `stream({ open() {} })` → `transportKind: "stream"`, `hasOpen: true` |
| Provider nested transport | `signalProvider` with stream transport kind |
| Lint | live `open` on `managedTransportBinding` options → `signal.transportBinding.live_value` |
| Native parity | same counts/kinds as static fixtures (extend signal native tests) |
| Epoch tests | if Go snapshot / cache identity bumps, existing epoch miss tests updated |

### Production

- `packages/core/src/project-index/signal-facts.ts` — add `"stream"`, `hasOpen?`
- Indexer extractors + primitive manifest + findings live field `open`
- Bump `STATIC_PARSE_CACHE_EPOCH` / related semantic epochs / `ProjectIndexSnapshotCacheEpoch` **only when** unchanged source would otherwise reuse stale output (same rule as AGENTS.md)

### Validation

```bash
pnpm --filter @use-crux/indexer exec vitest run \
  packages/indexer/__tests__/signal-native-static.test.ts \
  packages/indexer/__tests__/signal-lint-contract.test.ts \
  packages/indexer/__tests__/signal-lint-native-parity.test.ts
# plus any new stream-specific files
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/indexer typecheck
git diff --check
```

If Go epoch changed:

```bash
# from packages/local or via make targets used for identity tests
pnpm --filter @use-crux/local test  # only if package script covers identity; else go test for identity package
```

Prefer the repo’s existing local/Go identity test command used in recent Signal transport PRs.

### Commit

`feat(indexer): discover stream() transport authoring`

---

## Stage 10 — Docs + architecture + changeset

**Intent:** Progressive docs; no behavior change.

### Content

| Target | Change |
| --- | --- |
| `apps/docs/content/docs/guides/durable-execution/signals/providers.mdx` | Stream row in table; minimal `stream({ open })` path; lifecycle (EOF reconnect, faulted, config invalidation) |
| `apps/docs/content/docs/reference/crux-core/signal/providers-and-transports.mdx` | Full `stream` reference, StreamItem table, terminal error, checkpoint status/configRef |
| Recipes if present | One async generator example |
| `packages/core/src/signal/ARCHITECTURE.md` | Stream fiber + durable status; SSE/WS still follow-on |
| `.changeset/reactive-durable-execution.md` | Append minor note for stream supervision (core/postgres/indexer[/local]) |

### Validation

```bash
# Docs package if there is a lint/typecheck; otherwise content review only
git diff --check
# Re-read changeset: no new .changeset file, no major
ls .changeset/*.md
```

### Commit

`docs(runtime): document managed stream supervision`

---

## Stage 11 — Full gate (before PR ready)

Run broader suites **sequentially** to avoid OOM:

```bash
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/signal-provider-transport
pnpm --filter @use-crux/postgres exec vitest run \
  packages/postgres/__tests__/runtime-worker-stream.test.ts \
  packages/postgres/__tests__/runtime-worker-polling.test.ts \
  packages/postgres/__tests__/transport-conformance.test.ts
pnpm --filter @use-crux/indexer exec vitest run packages/indexer/__tests__/signal
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/postgres typecheck
pnpm --filter @use-crux/indexer typecheck
git diff --check
```

Manual checklist against design:

- [ ] No SSE/WS implementation
- [ ] No second worker/daemon/registry/lease type
- [ ] Pull backpressure (serial item handling)
- [ ] Checkpoint only after accept for envelope cursors
- [ ] Faulted survives restart
- [ ] Config change invalidates cursor
- [ ] Polling tests still green
- [ ] Changeset updated, not duplicated
- [ ] No forbidden agent/tool names in branch/commits/content

### Optional Devtools honesty

If Catalog already lists transport kind from Project Index, verify stream appears after index fixtures. If live reconnect UI is unsupported, leave a short “future work” note in ARCHITECTURE.md only — no fake Devtools surface.

---

## Suggested vertical commit order (summary)

1. `docs(runtime): design managed stream supervision` ← **this phase**
2. `feat(runtime): author stream() transport beside polling`
3. `feat(runtime): classify managed stream terminal failures`
4. `feat(runtime): persist transport checkpoint config and status`
5. `feat(runtime): accept stream items under lease-fenced checkpoints`
6. `feat(runtime): reconnect managed streams with bounded backoff`
7. `feat(runtime): invalidate stream cursors on config change`
8. `feat(runtime): supervise stream bindings on the Runtime worker`
9. `test(runtime): prove stream accept/checkpoint redelivery`
10. `feat(postgres): durable managed stream supervision`
11. `feat(indexer): discover stream() transport authoring`
12. `docs(runtime): document managed stream supervision` (+ changeset append if not done earlier)

Stages may be squashed if a vertical slice is tiny, but do not merge unrelated failures into one green attempt.

## Out of scope reminders for implementers

- Do not add `sse()` / `websocket()` in this PR.
- Do not freeze `ackToken` / `onEnvelopeAccepted` as required API.
- Do not store reconnect attempt history durably.
- Do not batch multiple envelopes in one `StreamItem`.
- Do not block `createRuntimeWorker` maintenance tick on long `for await` loops — fibers only.
- Do not create a new changeset file; update `reactive-durable-execution.md`.

## Implementation entrypoint for the next session

1. Read the design doc end-to-end.
2. Start Stage 0 tests only.
3. Keep commits small and green.
4. Stop and report if a design conflict with main is discovered after another merge; update the design doc in-tree before inventing APIs.
