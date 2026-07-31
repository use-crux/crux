# Effects core slice — TDD implementation plan

Status: **ready to implement**

Specifications:

- [Contract: RFC #196](https://github.com/use-crux/crux/issues/196) (source of
  truth for names, types, and semantics)
- [Core slice design](../specs/2026-07-30-effects-core-slice-design.md)
  (module layout, seam bindings, scope cut)

## Operating protocol

Work in the order below. Every task uses red-green-refactor:

1. Add the smallest focused failing runtime or type test.
2. Run it and confirm it fails for the intended reason.
3. Add the minimum production behavior.
4. Run the focused test until green.
5. Refactor types, JSDoc, and module boundaries while green.
6. Run the focused files with
   `pnpm --filter @use-crux/core exec vitest run <files>` and run the package
   typecheck before moving on.

Tests assert public behavior through `@use-crux/core/effect` exports — never
internal ledger/planner calls. Handlers in tests are plain in-memory fakes
(counters, maps); no timers, no network. Runtime tests live in
`packages/core/__tests__/effect-*.test.ts`; type tests in
`packages/core/__type_tests__/effect.test-d.ts`.

Stage boundaries below are mergeable PR cuts. Do not start a stage until the
previous one is green.

## Stage A — definitions, receipts, rollback (in-process)

### 1. Definition and direct call

- Type tests first: base overload preserves input/output; no-input effect is
  callable with zero args; 1-arg executor valid; executor context
  (`idempotencyKey`, `receiptId`, `scope`) typed on the 2-arg form.
- `effect('email.send', fn)` returns a callable; calling it runs the executor
  and returns the output unchanged.
- `definition.id`, `version` default `1`, `_tag` brand.
- Duplicate `(id, version)` creation throws `EFFECT_DUPLICATE_ID`; the same
  definition object re-imported does not. Test-only registry reset.

### 2. Receipts and `.run()`

- `.run()` returns `{ output, receipt }`; the callable form does not change
  shape.
- Receipt ref is discriminated (`kind: 'effect.receipt'`); `.run()` with no
  active boundary yields a receipt ref, and `recover()`-side lookups (phase 3)
  confirm valid `scopeId`/`boundaryId` (implicit root boundary). The callable
  form has no receipt-inspection surface — assert via `.run()` only.
- Executor throw → `outcome: 'failed'` with error code/message on the
  receipt; success → `succeeded`. Monotonic transitions: an illegal ledger
  transition throws (covered indirectly via reconcile tests later).

### 3. Recoverable effects and `recover()`

- Type tests: recoverable overload returns `RecoverableEffectDefinition`;
  extracted options with `satisfies RecoverableEffectOptions<…>` keep
  `.recover()`; `recover(scopeRef)` and `rollback(receiptRef)` are compile
  errors.
- `recover(execution.receipt)` invokes the recovery handler with
  input/output/receipt/resource and a recovery idempotency key distinct from
  the execution key; returns `RecoveryUnitResult` with `status: 'recovered'`.
- Second `recover()` of the same receipt → `already_recovered`, handler not
  re-invoked.
- `definition.recover(receipt)` validates the effect id and delegates;
  mismatched receipt rejects.
- Unknown/foreign ref id → `EFFECT_SCOPE_NOT_FOUND` (scope) /
  `EFFECT_RECEIPT_NOT_FOUND` (receipt) before any handler runs.

### 4. Capture recovery and resource projection

- Type test: `TCaptured` inferred from unannotated async `capture`.
- `capture` runs before the executor; its value reaches
  `recover.execute` as `captured`.
- Capture failure → executor never runs, receipt records preparation
  failure, `EFFECT_CAPTURE_FAILED`.
- `resource` projection runs before execution; a throw fails closed with
  `EFFECT_RESOURCE_FAILED` and no executor invocation; projected resource
  appears on receipt and recovery context.

### 5. `rollbackOnError()` — automatic rollback

- Callback throws after two recoverable effects → both recovered in LIFO
  order (assert order via handler log), original error rethrown unchanged.
- Callback succeeds → no recovery runs; value returned.
- Required mode (default): a non-recoverable effect inside the boundary is
  blocked *before its executor runs* with `EFFECT_RECOVERY_REQUIRED` naming
  effect + boundary and listing the three next actions.
- `{ recovery: 'best-effort' }`: irreversible effect executes; on error the
  rollback result records it (`unavailable`/`irreversible`) and
  `RollbackError` carries the partial `RollbackResult` and original `cause`.
- A recovery handler that throws during automatic rollback →
  `RollbackError` with `recoveryError`, remaining safe units still attempted.

### 6. Boundary controller and terminal scopes

- `scope.rollback({ reason })` inside the callback recovers completed units
  and returns `RollbackResult`; callback can return a rejection value.
- After rollback begins, starting another effect in the boundary throws
  `EFFECT_SCOPE_TERMINAL`; pure computation may still return.
- Error-precedence table from the RFC, one test per row: required mode +
  incomplete manual rollback → `RollbackError` (no `cause` when callback
  returned); callback throws after completed manual rollback → original error
  unchanged; callback throws after incomplete rollback → `RollbackError` with
  callback error as `cause`; caught-and-ignored pre-result recovery failure
  still fails the wrapper with `recoveryError` recorded.

### 7. `rollback(scopeRef)` and aggregate status

- `rollbackOnError` returns normally; later `rollback(controller.ref)` from
  outside recovers the scope's units (delayed in-process rollback).
- Aggregate precedence as table-driven tests over unit-status combinations:
  all recovered → `completed`; recovered+expired → `partial`;
  failed+conflict → `failed`; all blocked → `not_possible`; cancellation via
  `signal` mid-plan → `cancelled` with unsettled units.
- Repeated `rollback()` of the same scope: recovered units report
  `already_recovered`; failed units are retried; successful siblings not
  repeated.
- Unknown scope ref throws `EFFECT_SCOPE_NOT_FOUND` before any recovery.

### 8. Nesting and ordering

- Nested `rollbackOnError()` inside an outer boundary: child rolls back
  relative to its entry; outer rollback later skips child-recovered units and
  still recovers its own earlier units.
- A completed child boundary is one unit in the parent plan; rolling the
  parent back traverses the child stack recursively (assert full order).
- Nested custom effects: parent-with-direct-recovery recovers before its
  children (RFC `campaign.publish` shape).
- Occurrence identity: calling one definition twice in a boundary yields
  distinct receipts, stable distinct idempotency keys, and reverse-order
  recovery.
- Effects called inside existing kernel scopes attach to the nearest
  `rollbackOnError` boundary and record grouping ancestry on receipts.
  Use immediate flow execution (`flow.step(…)` calling an effect inside a
  `rollbackOnError` boundary) as one public-surface vehicle; for tool
  ancestry, exercise the real tool lifecycle
  (`createToolLifecycle()` from `@use-crux/core/adapter/tool`) so the test
  proves the actual `adapter/tool/scope.ts` seam, not just raw kernel
  descriptor capture.

### 9. Ambiguity and `reconcileEffect()`

- Executor throws `EffectOutcomeUnknownError` → receipt `outcome: 'unknown'`,
  recovery `ambiguous`; boundary rollback excludes it (aggregate per
  precedence) and never invokes its handler.
- `reconcileEffect(receipt, { outcome: 'succeeded', output, reason })` →
  receipt `succeeded`, unit active, subsequent rollback recovers it.
- Reconcile as `failed` → settled, no unit.
- Reconciling a non-`unknown` receipt or wrong effect id/version rejects
  (`EFFECT_OUTCOME_AMBIGUOUS` family).
- Recovery attempt reaching `unknown` (handler throws
  `EffectOutcomeUnknownError`): not auto-retried; reconciling it as
  succeeded marks attempt + unit + original receipt recovered atomically;
  as failed → unit active and retryable.

### Stage A exit

- All Stage A tests green; `__type_tests__/effect.test-d.ts` locked.
- `"./effect"` subpath export **and** `typesVersions["*"]["effect"]` wired;
  root re-exports added.
- JSDoc complete per house style; files < 300 lines.

## Stage B — evidence and observability projections

### 10. Evidence contribution

- Receipt settlement contributes intent + change evidence with the
  `EvidenceEffectReceiptRef` subject; recovery settlement contributes
  recovery evidence linked to the original receipt. Assert via the evidence
  read model (`inspectEvidence()` in `evidence/inspect.ts`), not collector
  internals.
- No input/output/captured values appear in evidence records (fixture
  assertion).

### 11. Observability taxonomy (additive on schema v5)

- Taxonomy: `effect` family + `effect.run` primitive; additive
  receipt-summary artifact and `recovery.of` relationship. No version bump
  per `VERSIONING.md` (additive primitives/edges/artifact kinds) — but run
  its full Field-Change Checklist: contract, schema, shared fixtures, TS
  contract tests, type tests, Go mirror, docs. Escalate to a bump only if a
  change tightens existing validation, and record why.
- Custom effect execution emits `effect.run` with receipt summary; recovery
  attempt emits `effect.run` + `recovery.of` (graph fixture tests, privacy
  fixtures proving no envelope data on the wire).
- Go local runtime (`packages/local/internal/observability`) mirrors the new
  taxonomy values in the same change; follow the v5 evidence change as the
  checklist template (including read-model cache identity), then
  `make build` and reindex verification.

### Stage B exit

- Graph/privacy fixtures green in core and local; the full Field-Change
  Checklist items landed in one change.

## Stage C — docs and release

### 12. Documentation and release mechanics

- `apps/docs/content/docs/guides/` Effects guide + reference entries for the
  seven public exports; error pages under `docs/errors/` for each public
  slice-1 code.
- Update the package Key APIs notes (add `/effect`) and `ARCHITECTURE.md`
  module map.
- Changeset: inspect `.changeset/*.md` first per repo policy; extend an
  existing pending changeset if one covers this release theme, otherwise add
  one `minor` changeset for `@use-crux/core` describing the new
  `@use-crux/core/effect` surface.

## Out of scope (do not build speculatively)

`RecordStore` persistence, Runtime targets/leases/replay, `result.effects` on
flow/pipeline/agent results, `flow.rollback()`, native providers and shared
units, Project Index discovery/lint, policy/approval, Devtools UI. The design
doc lists the seams each of these will attach to.
