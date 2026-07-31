# Effects Core Slice Design — in-process `effect()`, receipts, and rollback

Status: **ready for plan review**

Contract owner: [RFC #196 — Effects, receipts, recovery, and rollback](https://github.com/use-crux/crux/issues/196).
This document does not restate the RFC. It maps RFC rollout slice 1
("Core/in-process: definitions, receipts, scopes, `rollbackOnError`, ordering,
and observability") onto the current codebase and fixes the decisions an
implementer needs: module layout, seam bindings, type-level design, and the
exact scope cut.

Companion foundations already landed:

- Execution-scope seam (#232): `packages/core/src/scope/` — kernel, facet
  slots, retention, `runScope`/`openScope`/`currentScopeFacet`.
- Execution evidence (#286/#295): `packages/core/src/evidence/` — including
  `EvidenceEffectReceiptRef` in `subjects.ts`, already reserved for Effects.
- Scope-opening call sites that Effects will observe for grouping ancestry:
  `adapter/tool/scope.ts` (tool), `flow/scope.ts` (flow-step),
  `adapter/execution/scope-boundary.ts` (adapter-call),
  `agent/composition-runtime/execution.ts`, `eval/internal/scope.ts`,
  `defer/internal/ambient.ts` (invocation).

## Scope cut

### In this slice

- `@use-crux/core/effect` subpath with the RFC public surface:
  `effect()`, `recover()`, `rollback()`, `rollbackOnError()`,
  `reconcileEffect()`, `EffectOutcomeUnknownError`, `RollbackError`, and the
  public types. Stable values/types re-exported from `@use-crux/core`.
- In-process receipts, recovery envelopes, recovery stacks, and rollback with
  the RFC's exact ordering, status vocabulary, aggregate-status precedence,
  idempotent re-rollback, and error-precedence rules.
- Boundary model: explicit `rollbackOnError()` boundaries plus the implicit
  one-operation root boundary. Grouping ancestry (tool, flow-step,
  adapter-call, …) is recorded on receipts from the live kernel scope stack.
- Ambiguous outcomes: `EffectOutcomeUnknownError`, exclusion from automatic
  rollback, and in-process `reconcileEffect()` for original and recovery
  attempts.
- Evidence projection: every receipt resolves as a #286 evidence subject;
  effects contribute intent/change/recovery evidence records.
- Observability: additive taxonomy change on schema v5 — the `effect` family,
  the `effect.run` primitive, a receipt-summary artifact, and the
  `recovery.of` relationship. Custom effects emit `effect.run`; recovery
  attempts emit `effect.run` with a `recovery.of` link.

### Deferred (explicitly not in this slice)

| Deferred | Lands with |
| --- | --- |
| Durable receipts/envelopes via `RecordStore`, delayed recovery | RFC slice 2 (swap point: internal ledger port below) |
| Runtime targets, leases, retries, crash windows, replay | RFC slice 2 (#299 integration) |
| Automatic run-like boundaries + `result.effects` / `flow.rollback()` / `FlowScope.effects` | RFC slice 3 (needs result-surface changes across adapters) |
| `NativeEffectProvider` contract, shared units, checkpoints, conflict fingerprints | RFC slices 4–5 (#258 for Workspace) |
| Project Index discovery, `effect.recovery_not_runtime_addressable` and other lint findings | With slice 2 target manifests |
| Policy/approval matching, Devtools cards/preview | RFC slice 6 |

Consequence of deferring native providers: in this slice every recovery unit
covers exactly one receipt, `EFFECT_RECOVERY_SHARED_UNIT` and shared-unit
rejection are reserved (typed, documented, untested-able), and `conflict`
handling for custom effects is the RFC rule — the handler owns optimistic
concurrency; Crux passes `conflict` mode and resource identity through.

## Public surface

`packages/core/package.json` gains an `"./effect"` export **and** an
`"effect"` entry in `typesVersions["*"]` (both, same dist wiring as `flow`).
`packages/core/src/index.ts` re-exports the stable values/types.

```ts
// packages/core/src/effect/index.ts — re-exports only
export { effect } from "./define-effect";
export { recover, reconcileEffect } from "./recover";
export { rollback } from "./rollback";
export { rollbackOnError } from "./rollback-on-error";
export { CruxEffectError, EffectOutcomeUnknownError, RollbackError, EFFECT_ERROR_CODES } from "./errors";
export type { /* public types, see types.ts */ } from "./types";
```

Type and callable shapes are exactly the RFC "Proposed types" blocks
(`EffectDefinition`, `RecoverableEffectDefinition`, `EffectCallArgs`,
options/context/result interfaces, `RollbackResult`, `RecoveryUnitResult`,
`EffectReceipt`, `EffectOutcome`, `RecoveryAvailability`). Do not rename or
"improve" RFC names; the RFC is the reviewed contract.

## Module map

New module `packages/core/src/effect/`, mirroring `defer/`'s public/internal
split. Every file stays under ~300 lines; if a file grows past that, split by
the concern boundaries already listed here rather than inventing new ones.

```text
packages/core/src/effect/
  index.ts               public re-exports only
  types.ts               public contract types: refs, resources, options,
                         contexts, results, definition interfaces
  receipt-types.ts       EffectReceipt, EffectOutcome, RecoveryAvailability,
                         RecoveryEnvelope, unit/scope record types
  errors.ts              EFFECT_ERROR_CODES, CruxEffectError,
                         EffectOutcomeUnknownError, RollbackError
  define-effect.ts       effect() overloads, definition assembly, (id, version)
                         duplicate detection
  recover.ts             recover(), reconcileEffect(), definition .recover()
  rollback.ts            rollback(scopeRef) public entry
  rollback-on-error.ts   rollbackOnError(), RollbackBoundaryController
  internal/
    ledger.ts            EffectLedger port + in-memory implementation
    boundary.ts          boundary facet slot, nearest-boundary resolution,
                         implicit root boundary, terminal-state gate
    execution.ts         one effect occurrence lifecycle: resource projection →
                         capture → prepared → run → settle/unknown
    occurrence.ts        occurrence identity + stable idempotency keys
    recovery-stack.ts    append-only unit registration, nested-boundary units
    plan.ts              pure rollback planner: ordering, skip rules, statuses
    run-rollback.ts      plan execution, per-unit settlement, aggregate
                         precedence, idempotent re-entry
    reconcile.ts         unknown-outcome transitions for originals and
                         recovery attempts
    observability.ts     effect.run spans, receipt-summary artifact,
                         recovery.of links
    evidence.ts          receipt → evidence subject + intent/change/recovery
                         contribution
```

Deep-module boundaries the RFC requires and this layout enforces:

- `plan.ts` is pure (records in, ordered plan + expected statuses out); it
  never invokes handlers. `run-rollback.ts` executes a plan. This is the seam
  slice 2 reuses for Runtime-driven rollback.
- `ledger.ts` is the only owner of receipt/unit/envelope state. Everything
  else reads/writes through its port. Slice 2 adds a `RecordStore`-backed
  implementation behind the same port; no caller changes.
- `observability.ts` and `evidence.ts` are projections. They read receipts;
  they never influence execution or rollback decisions.

## Execution-scope integration

One facet slot, created with `createScopeFacetSlot` from
`@use-crux/core/internal/scope`:

```ts
const effectBoundaryFacet = createScopeFacetSlot<EffectBoundaryState>("effect.boundary");
```

Rules:

- `rollbackOnError()` wraps its callback in
  `runScope({ kind: "effect-boundary", name? }, …)` and sets the facet.
  `ScopeKind` in `scope/types.ts` gains `"effect-boundary"`.
- Effect execution resolves the nearest boundary via
  `currentScopeFacet(effectBoundaryFacet)`. If none exists, the call creates
  an implicit one-operation root boundary (RFC "no rootless receipts"), so
  `scopeId`/`boundaryId` are always valid and `.run()` always returns a
  receipt ref.
- Grouping ancestry is *observed*, not owned: receipts snapshot
  `currentScopeStack()` descriptors (tool, flow-step, adapter-call, eval-*)
  into `scopeId`/`toolCallId`/`flowId`/`stepId` fields where derivable. No
  existing scope-opening call site changes in this slice.
- Effects do not import defer internals. If execution interception needs
  anything the kernel lacks, extend `scope/` (the neutral seam), not `defer/`.

Boundary terminal state (`EFFECT_SCOPE_TERMINAL`) lives on the facet state:
once rollback starts, `execution.ts` checks the resolved boundary's state
before running capture/resource projection and rejects new effects.

## Type-level design

- Overload order in `define-effect.ts` is exactly the RFC's: captured-
  recoverable → recoverable → base, so extracted required-recovery options
  keep `.recover()` on the returned definition.
- `TCaptured` is inferred from `recover.capture`'s awaited return type; no
  explicit annotation required for `async ({ input }) => crm.getCustomer(...)`.
- `EffectCallArgs<TInput>` uses the RFC's `[TInput] extends [void]` tuple so
  no-input effects are callable with zero arguments (non-distributive on
  purpose — keep the tuple wrapping).
- The definition brand is `readonly _tag: 'EffectDefinition'`, consistent with
  existing definition tagging; `RecoverableEffectDefinition` narrows purely by
  the presence of `.recover`, discriminated in type tests via the overloads,
  not by widening `_tag`.
- Discriminated refs: `EffectReceiptRef.kind: 'effect.receipt'` and
  `EffectScopeRef.kind: 'effect.scope'` must reject each other at the API
  boundary (`recover(scopeRef)` and `rollback(receiptRef)` are compile
  errors, and runtime-validated for round-tripped JSON before ledger lookup).
- Type tests live in `packages/core/__type_tests__/effect.test-d.ts` and lock:
  inline vs extracted options (`satisfies CapturedRecoverableEffectOptions`),
  unannotated async capture inference, no-input effects, executor context
  optionality (1-arg executors stay valid), tool `execute:` compatibility, and
  ref cross-rejection.

## Receipt ledger (internal port)

```ts
/** @internal Single owner of effect state. Slice 2 adds a RecordStore-backed impl. */
interface EffectLedger {
  createReceipt(init: EffectReceiptInit): EffectReceipt;
  transition(receiptId: string, patch: ReceiptTransition): EffectReceipt; // monotonic only
  putEnvelope(envelope: RecoveryEnvelope): void;
  registerUnit(boundaryId: string, unit: RecoveryUnitRecord): void;
  markUnit(unitId: string, status: RecoveryUnitLifecycle): void;
  getReceipt(id: string): EffectReceipt | undefined;
  getScope(id: string): EffectScopeRecord | undefined;
  unitsFor(boundaryId: string): readonly RecoveryUnitRecord[];
}
```

- `transition()` enforces monotonic lifecycle
  (`preparing → running → succeeded | failed | cancelled | unknown`;
  reconciliation is the only exit from `unknown`). Illegal transitions throw —
  a ledger bug must never silently rewrite history.
- Envelope values are held by reference in memory. A JSON-safety probe
  (an Effects-local validator following `evidence/json-validation.ts` —
  finite primitives, plain objects/arrays, no cycles/undefined) sets a
  `durable: boolean` flag now so slice 2 can refuse non-durable persistence
  honestly; in-process rollback uses the ephemeral value either way, per the
  RFC's non-serializable rules.
- Required-recovery boundaries in this slice require recovery to be *defined*,
  not durable. Durability enforcement arrives with persistence in slice 2.

## Rollback semantics to encode verbatim

These are already fully specified in the RFC; the implementation must encode
them as data/pure functions with table-driven tests rather than scattered
conditionals:

1. Aggregate-status precedence (completed → cancelled → partial → failed →
   not_possible) as a pure function over unit results in `plan.ts`.
2. `rollbackOnError()` error precedence: completed rollback rethrows the
   original error unchanged; anything else throws `RollbackError` with
   `cause`/`result`/`recoveryError` per the RFC bullet list, including the
   "tracked pre-result recovery error wins over callback completion" rule.
3. LIFO unit order; a completed child boundary is one unit in its parent and
   recursively traverses its own stack; recovered units are idempotently
   skipped (`already_recovered`).
4. Occurrence identity `(boundary id, deterministic scope path, effect id,
   effect version, occurrence index)` with distinct stable idempotency keys
   for execution vs recovery (`occurrence.ts`). Slice 1 guarantees stability
   within one boundary execution; replay equivalence is slice 2.
5. Duplicate `(id, version)` definition creation throws `EFFECT_DUPLICATE_ID`
   via a small module registry. Note this is *stricter* than the existing
   `runtime/api/target-registry.ts`, which warns and overwrites — the RFC
   requires conflicting duplicates to be an error, so Effects owns its own
   registry semantics: identical re-exports (same object) collapse; a
   different definition for the same pair throws. Expose an
   Effects-owned `…ForTesting` reset helper.

Parallel branches: V1 serializes recovery (RFC allows this) but `plan.ts`
must already order by the causal model + recorded sequence, never wall-clock,
so concurrency can be added in place later.

## Ambiguity and reconciliation

- Executors signal unknown commit outcomes only via
  `EffectOutcomeUnknownError`; arbitrary thrown errors are known failures.
- `unknown` receipts: excluded from plans (status `ambiguous`), never
  auto-retried, never auto-compensated.
- `reconcileEffect()` in-process: validates ref kind, effect id/version, and
  `unknown` state; `succeeded` requires output when the definition's recovery
  needs it, and activates the unit; `failed` settles without a unit.
  Reconciling a recovery attempt as succeeded atomically marks attempt, unit,
  and covered receipt recovered (single-receipt units in this slice).

## Evidence integration

`internal/evidence.ts` uses the existing collector
(`evidence/collector.ts`, `activeEvidenceCollector`) and the already-shipped
`EvidenceEffectReceiptRef`:

- On receipt settlement, contribute `intent` (definition identity + resource
  summary) and `change` (outcome) evidence with the receipt as subject.
- On recovery settlement, contribute `recovery` evidence linked to the
  original receipt.
- Approval/verification roles are contributed by their owning systems later;
  Effects must not fabricate them.
- Never place input/output/captured values in evidence — receipt-safe
  summaries only.

## Observability (additive taxonomy change, no version bump)

Per `observability/VERSIONING.md`, adding a canonical primitive, edge type,
or artifact kind while preserving existing values does **not** require a
schema-version bump. This stage is therefore additive on schema v5, but still
runs the full Field-Change Checklist from `VERSIONING.md` (contract, schema,
shared fixtures, TS contract tests, type tests, Go mirror, docs):

- `taxonomy.ts`: add family `"effect"`, primitive `"effect.run"`, family
  mapping.
- Additive contract/schema entries: receipt-summary artifact shape (ids,
  statuses, safe resource summary — never envelope data) and the qualified
  `recovery.of` relationship. The canonical artifact kind is
  `effect.receipt`; its strict JSON preview carries `receiptId`, `effectId`,
  `effectVersion`, `scopeId`, `boundaryId`, optional `parentReceiptId`,
  terminal `outcome`, `recovery`, and an optional safe resource summary.
  `effect.run` start attributes are `crux.effect.id`, `crux.effect.version`,
  `crux.effect.receipt.id`, `crux.effect.scope.id`,
  `crux.effect.boundary.id`, optional `crux.effect.parent_receipt.id`,
  `crux.effect.outcome`, and `crux.effect.recovery`. A `recovery.of` edge
  connects the recovery-attempt span to the original effect span. These
  qualifications apply only to the newly added taxonomy values, so all
  previously valid v5 records remain valid. If any later part turns out to
  *tighten* existing validation, that specific part escalates to a version
  bump per the policy — state the reason in `VERSIONING.md` if so.
- Emission through the existing `observe()` API from `internal/observability.ts`:
  custom effects emit `effect.run`; recovery attempts emit `effect.run` +
  `recovery.of`. Native-span effect facets (workspace/memory/…) arrive with
  native providers, not now — nothing emits duplicate generic nodes today
  because no native provider exists yet.
- Go local runtime (`packages/local/internal/observability`) mirrors the new
  taxonomy values for storage and read models in the same change, with the
  shared fixture corpus updated (`observability/fixtures`). Follow the v5
  (evidence) change as the template for the cross-runtime checklist,
  including any read-model cache identity it touched.

## Errors

Model on `defer/errors.ts`: a code catalog, one `CruxEffectError` with
`code`/`docsUrl`/`cause`, plus the two RFC-named classes (`RollbackError`,
`EffectOutcomeUnknownError`) which carry their RFC fields and a code.

Slice-1 catalog: `EFFECT_DUPLICATE_ID`, `EFFECT_RESOURCE_FAILED`,
`EFFECT_CAPTURE_FAILED`, `EFFECT_RECOVERY_REQUIRED`,
`EFFECT_SCOPE_NOT_FOUND`, `EFFECT_RECEIPT_NOT_FOUND`,
`EFFECT_SCOPE_TERMINAL`, `EFFECT_OUTCOME_AMBIGUOUS`,
`EFFECT_ROLLBACK_PARTIAL`. (`EFFECT_RECEIPT_NOT_FOUND` is an addition to the
RFC's candidate list — unknown receipt refs need their own code, parallel to
the scope one.)
Reserved for later slices (typed in the catalog, documented, not yet
reachable): `EFFECT_RECOVERY_NOT_DURABLE`,
`EFFECT_RECOVERY_HANDLER_UNAVAILABLE`, `EFFECT_RECOVERY_SHARED_UNIT`,
`EFFECT_RECOVERY_CONFLICT`, `EFFECT_NATIVE_RECOVERY_UNSUPPORTED`.

`EFFECT_RECOVERY_REQUIRED` must name the blocked effect and boundary and list
all three next actions (define recovery, move the effect out, or
`{ recovery: 'best-effort' }`) — the strict default is only acceptable if its
first failure teaches the escape hatch. Each public code gets an
`apps/docs/content/docs/errors/` page.

## JSDoc and style

- Every public file opens with a `@module` JSDoc block; every exported value,
  type, and member gets JSDoc with `@param`/`@returns`/`@example` on
  factories and operations — follow `adapter/define-adapter.ts` and
  `defer/errors.ts` as the house style (Next.js/ai-sdk register: what it does,
  when to use it, one runnable example).
- Hand-formatted; do not run bare prettier.
- No workplan-phase references in source or comments; describe conditions.

## Follow-up seams this slice must leave clean

- `EffectLedger` port ready for a `RecordStore` implementation (slice 2).
- `plan.ts`/`run-rollback.ts` split so Runtime can execute plans it did not
  build in-process (slice 2).
- Boundary facet ready for run-like roots (flow run, composition roots) to
  opt in without changing effect execution (slice 3: `result.effects`,
  `flow.rollback()`).
- Unit records already shaped for multi-receipt coverage
  (`effectIds: readonly string[]`) so native shared units are additive
  (slices 4–5).
