# Eval Cell Cancellation and Structured Timeouts Design

Status: **proposed**

Related:

- [Issue #244](https://github.com/use-crux/crux/issues/244)
- [Public API contract](./2026-07-26-eval-cell-cancellation-api.md)
- [Runtime, Generation, and Eval DX](./2026-07-20-runtime-generation-eval-dx-design.md)
- existing structured generation timeouts, Eval execution scopes, and Eval Host V1

## Summary

Every live Eval task attempt should execute with one engine-owned
`AbortSignal`. An authored structured timeout policy supplies the deadlines
that Crux owns:

```ts
export default evaluate({
  task: support,
  timeout: {
    totalMs: 30_000,
    stepMs: 10_000,
    toolMs: 5_000,
    tools: {
      search: 15_000,
    },
  },
  cases: [
    { input: ordinaryInput },
    {
      input: slowInput,
      timeout: {
        totalMs: 60_000,
        toolMs: null,
      },
    },
  ],
})
```

Managed tasks receive the signal and structured budgets automatically through
their private execution descriptor. An opaque task can read the active signal
without changing its existing `(input, call?)` contract:

```ts
async function support(input: SupportInput) {
  const { signal, timeout } = evalContext()
  return generate(prompt, {
    input,
    signal,
    timeout,
  })
}
```

When an Eval deadline wins, Crux aborts the signal, seals the cell scope with
`timeout`, returns a first-class `timed_out` cell, and prevents late work from
publishing evidence or a remote result. User code is never forcibly terminated.

## Non-goals

- forcibly terminating JavaScript, workers, or processes;
- adding cancellation to general Crux `ExecutionContext`;
- changing request retention or host lifecycle contracts;
- timing external scorers or assertion callbacks;
- guaranteeing that user side effects stop after abort;
- accounting exactly for provider cost incurred after a timed-out task detaches;
  or
- defining general cancellation for Flow, Agent, or other non-Eval primitives.

## Public contract

The exact public signatures, JSDoc, inheritance rules, and rejected alternatives
live in the focused
[Eval cancellation API contract](./2026-07-26-eval-cell-cancellation-api.md).
The architecture below treats that contract as binding.

Policy identity fingerprints semantic normalization: positive finite budgets
use integer milliseconds; explicit disabled numbers canonicalize to `null`.
Whole-Case `null` resolves to clears for exactly inherited Eval fields/Tools
and participates in definition, deployment, and evidence identity.

## Execution lifecycle

The cell controller owns an `AbortController`, deadline timers, and the
single-winner terminal transition. Its state is conceptually:

```text
open -> succeeded
     -> timed_out
     -> errored
     -> cancelled
```

Only the first transition may publish a task result. The controller:

- installs the task context before invoking managed or opaque task code;
- composes the cell signal with caller and narrower adapter signals;
- exclusively owns the Eval-authored outer `totalMs` timer;
- passes the remaining Eval ceilings to the private managed-task descriptor;
- lets managed execution own task-authored total, step, chunk, first-token, and
  Tool timers;
- disposes timers after a successful or errored task settlement; and
- seals the existing Eval cell scope with the matching outcome.

Eval `totalMs` is not armed again inside managed generation. A task's own
`totalMs` remains an independent, possibly narrower production budget. Either
source produces the same `timed_out` status and canonical metadata, so an equal
deadline cannot race between timeout and generic error outcomes.

The shared task host recognizes an unhandled canonical `TimeoutError` with
`TimeoutError.isInstance()` and converts it to a private tagged timeout result
before the generic task-error boundary. This preserves `budget`, `limitMs`, and
`toolName` for managed or forwarded opaque execution without parsing messages.
A task that catches and handles a narrower timeout may still complete normally.

The timeout covers the live task attempt, including its model steps, retries,
and Tools. It does not cover evidence persistence, external scoring, or
assertions after successful task output. This matches the deployed Runtime,
which executes the task while the coordinator assesses its result.

When the outer deadline wins, the engine races forward immediately. The losing
task promise receives a rejection handler so a later failure cannot become an
unhandled rejection. The cell scope remains sealed and all late captured writes
are dropped. The next cell may start even though uncooperative user work is
still consuming resources.

The timeout outcome records real elapsed duration, the observability run IDs
known at seal time, and signals captured before sealing. It never waits for
terminal capture from abandoned work, and late signals cannot enter another
cell.

Crux cannot reliably detect whether code inspected an `AbortSignal`, so the
result does not claim an `observedSignal` value.

## Timeout outcome

The read model adds a terminal status:

```ts
type EvalCellStatus =
  | 'passed'
  | 'failed'
  | 'errored'
  | 'skipped'
  | 'timed_out'
```

A timed-out cell carries canonical timeout evidence:

```ts
interface EvalCellTimeout {
  readonly budget: TimeoutBudget
  readonly limitMs: number
  readonly toolName?: string
}
```

Its task decision is `timed_out`; its dependent scores are not evaluated; its
assertion summary records no executed assertions; and it has no generic
`error`. The cell duration ends when the timeout becomes terminal.

Crux classifies outer expiry through the cell controller and any unhandled
canonical nested expiry through the task host's tagged result. The existing
`TimeoutError` remains the error observed by direct generation callers.

A run containing timeouts is still `complete`: the engine obtained a valid,
comparable outcome for every admitted cell. `timed_out` counts in the active
denominator and against `passRate`; aggregates add `timedOut`, with
`cells = passed + failed + errored + timedOut`. The timeout path never adds
`task_error` to the run's incomplete reasons.

Baseline V3 coverage keeps `trials: number[]` unchanged and gains an additive
sibling:

```ts
readonly outcomes: readonly {
  readonly trial: number
  readonly status: 'passed' | 'failed' | 'timed_out'
}[]
```

A timed-out trial remains promotable and contributes `value: null` per declared
metric. Every V4 cell persists its admitted scorer names/contracts, so promotion
can seed metrics when all trials time out; `{}` means no scorer was declared.
`arithmetic_mean_non_null_v1` ignores nulls; `errored` still blocks promotion.

After trial-index equality, divergent outcomes return Case `incompatible` /
`trial_outcomes_changed` without metric comparisons. With matching outcomes, a
metric whose mean is null on either side returns `missing` /
`metric_value_unavailable`, making the Case `missing`. The new fingerprint epoch
makes coverage without outcomes incompatible and requires repromotion.

A timed-out task never writes reusable task evidence. Late completion cannot
change the cell, evidence store, run, cost settlement, or gate result.

## Remote execution

Eval Host V2 keeps a pre-start `deadlineAt` guard and distinguishes an authored
Eval deadline from the existing host transport ceiling. For a cell with
`totalMs`, the coordinator submits the earlier timestamp plus its source and
limit. The deployed target resolves the same frozen Eval/Case policy, arms an
in-flight controller, and follows the same terminal state machine as local
execution.

The target must gate result-store publication on the controller still being
open. Scope sealing alone is insufficient because direct Runtime result writes
are not captured defer writes. A late task may settle, but it cannot persist a
result or replace the host's terminal `expired` outcome.

V2 terminal status carries structured timeout metadata for outer and managed
nested budgets. This is required because V1 terminal errors use an exact key
set and cannot represent `budget`, `limitMs`, or `toolName`. A bounded poll
grace extends beyond the task deadline so clock skew cannot turn a real remote
timeout into `EVAL_HOST_POLL_TIMEOUT`.

An authored pre-start or in-flight expiry projects to `timed_out`; internal
diagnostics retain whether execution started. The independent host ceiling,
transport failure, explicit job cancellation, and ordinary task failure retain
their existing non-timeout semantics. Host V1 remains readable during rollout,
but only V2 advertises in-flight structured-timeout capability.

## Module boundaries

New behavior should be split by concern:

- `eval/timeout-policy.ts`: public policy merge, null handling, and validation;
- `eval/task-context.ts`: public accessors over an internal task-only scope;
- `eval/testing.ts`: the explicit context test seam;
- `eval/internal/cell-deadline.ts`: controller, timers, race, and terminal winner;
- `eval/internal/timeout-outcome.ts`: read-model projection;
- `eval/internal/task-execution-context.ts`: private managed descriptor context;
- `runtime/eval-host/execute-deadline.ts`: deployed in-flight enforcement; and
- `ai` execution option wiring in focused option/execution modules.

Touched large modules should delegate rather than grow:

- split public executor types from `adapter/define-executor.ts`;
- split task-host and run/cell types from `eval/internal/types.ts`;
- split descriptor types from `eval/internal/task.ts`;
- move cell outcome schemas out of `eval/internal/run-cell-schema.ts`;
- move remote execution from `eval/node/host/readiness.ts`; and
- extract managed descriptor execution before extending `ai/eval-task.ts`.

Public exports remain stable through re-exports. Refactors happen only after
the relevant behavior is green.

## Test strategy

Implementation proceeds as vertical red-green-refactor slices:

1. A local opaque task reads `evalContext().signal`; an elapsed `totalMs`
   returns `timed_out` without waiting for a task that ignores abort.
2. Eval and Case policies merge with `null` disables, freeze correctly, and
   participate in definition and evidence identity.
3. A managed AI task receives the same signal through generation, adapter, and
   Tool execution; the narrower task/Eval budget wins.
4. A timed-out cell produces complete-run status, timeout aggregates, no task
   evidence, real elapsed/run evidence, and comparable Baseline coverage.
5. An in-flight remote task produces the same outcome and cannot publish a late
   Runtime result; poll grace preserves the remote timeout classification.
6. An opaque task can forward `evalContext().timeout`; a named Tool `null`
   override does not fall through to `toolMs`.

Each slice starts with one observable behavior test and the expected red
failure. Tests use public entry points and existing scripted providers,
in-memory stores, and injected clocks. Internal collaborators are not mocked.
Compile-time assertions for existing task inference/call arity, Eval-owned
`signal`, nullable timeout fields, and generation options accompany the
behavioral slice whose public surface they protect; they are not a separate
horizontal TDD phase.

## Compatibility and release

The public status union grows, timeout fields accept `null`, Eval authoring gains
`timeout`, and AI calls gain `signal`. This is a minor release for the directly
affected `@use-crux/core`, `@use-crux/ai`, and `@use-crux/local` packages under
the repository's pre-1.0 release policy.

Implementation must:

- update or create one Eval-themed pending changeset after inspecting the queue;
- bump `TASK_EVIDENCE_CACHE_EPOCH` because timeout policy changes reuse identity;
- bump `BASELINE_FINGERPRINT_EPOCH` because cell coverage gains `timed_out`;
- include resolved policy in definition, deployed Eval/Case, and task-evidence
  fingerprints so an old Runtime fails readiness instead of running unbounded;
- emit Eval Run V4, retain a V3 reader, and update TypeScript and Go read-model
  consumers before Core can emit `timed_out`;
- add Baseline V3 outcome coverage under the bumped fingerprint epoch;
- update the Go Baseline epoch guard, diagnostics, and EvalFS fixtures in the
  same release; both TypeScript and Go accept only the new epoch, and old
  Baselines require repromotion;
- add the `@use-crux/core/eval/testing` export map and build entry;
- introduce Eval Host V2 for structured timeout terminals and advertise it in
  the remote host contract;
- document cooperative cancellation and late-work limitations; and
- add no Project Index or Go snapshot cache bump unless their emitted contracts
  actually change.
