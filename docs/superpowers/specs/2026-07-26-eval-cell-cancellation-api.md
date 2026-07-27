# Eval Cell Cancellation API Contract

Status: **proposed**

Related:

- [Eval Cell Cancellation and Structured Timeouts](./2026-07-26-eval-cell-cancellation-design.md)
- [Issue #244](https://github.com/use-crux/crux/issues/244)

## Task context

`@use-crux/core/eval` exports:

```ts
/**
 * Eval-owned nested budgets that a task may forward to managed calls.
 *
 * The cell signal owns the outer `totalMs` deadline.
 */
export type EvalTaskTimeout = Readonly<Omit<TimeoutOptions, 'totalMs'>>

/** Cancellation context for the active Eval task attempt. */
export interface EvalTaskContext {
  /**
   * Aborts when the effective Eval deadline expires or the attempt is
   * otherwise cancelled.
   */
  readonly signal: AbortSignal
  /**
   * Resolved Eval-owned nested timeout ceilings for the active attempt.
   *
   * Preserves explicit `null` inheritance overrides for nested budgets. The
   * cell signal already owns `totalMs`, so this object deliberately omits it.
   * Pass this exact object to managed calls; do not clone it.
   */
  readonly timeout: EvalTaskTimeout
}

/**
 * Read the execution context for the active Eval task attempt.
 *
 * @remarks
 * The context is stable across awaited work in the current attempt.
 * It is not available to Case assertions, scorers, or unrelated cell work.
 * Cancellation is cooperative and does not forcibly terminate user code.
 * Writes made after the cell is sealed are discarded.
 *
 * @returns The active task context.
 * @throws {TypeError} When called outside an active Eval task.
 *
 * @example
 * ```ts
 * const { signal, timeout } = evalContext()
 * return generate(prompt, { input, signal, timeout })
 * ```
 */
export function evalContext(): EvalTaskContext

/**
 * Read the execution context for the active Eval task attempt, when present.
 *
 * @returns The active context, or `undefined` outside an Eval task.
 *
 * @example
 * ```ts
 * return fetch(url, { signal: tryEvalContext()?.signal })
 * ```
 */
export function tryEvalContext(): EvalTaskContext | undefined
```

The context is available only while the task body or a function awaited by it
is running. `evalContext()` throws a stable `TypeError` outside that boundary.
The returned context and timeout object are frozen.

`@use-crux/core/eval/testing` exports:

```ts
/**
 * Run a callback with an Eval task context installed.
 *
 * @param context - Context visible to Eval context accessors.
 * @param callback - Synchronous or asynchronous work to run.
 * @returns The callback result without awaiting or transforming it.
 *
 * @example
 * ```ts
 * await withEvalContext({ signal, timeout: {} }, () => task(input))
 * ```
 */
export function withEvalContext<T>(
  context: EvalTaskContext,
  callback: () => T,
): T
```

The async-scope carrier propagates context through a returned Promise without
wrapping or changing it. This test seam avoids another task factory. Existing
opaque functions and managed production tasks keep their current call
signatures.

## Why an accessor

The cell scope already owns lifecycle state and isolates it across awaits and
concurrent cells. A narrow accessor makes that existing state available without
changing every task:

- injecting `signal` into the second argument would mutate user-authored
  `case.call` data and could collide with a real property;
- a third argument forces no-call tasks to author an unused `_call` parameter;
- `defineEvalTask()` would add a third task-construction surface beside
  `generate.task()` and `stream.task()`; and
- adding `signal` to general `ExecutionContext` would violate this RFC's scope.

`evalContext()` follows the scoped lifecycle style used by framework-owned
request APIs, while `signal` remains explicit at actual I/O boundaries.

## Authored timeout policy

`EvaluateOptions` and inline/file-backed Cases accept:

```ts
timeout?: TimeoutOptions | null
```

Crux reuses the canonical `TimeoutOptions`; its scalar and per-Tool values
accept `number | null`:

```ts
export interface TimeoutOptions {
  readonly totalMs?: number | null
  readonly stepMs?: number | null
  readonly chunkMs?: number | null
  readonly firstToken?: number | null
  readonly toolMs?: number | null
  readonly tools?: Readonly<Record<string, number | null>>
}
```

The existing `firstToken` budget remains available because a single canonical
timeout vocabulary is more predictable than an Eval-specific subset.

Authoring semantics are:

- an absent field inherits the Eval-level value;
- a Case field replaces the corresponding Eval-level value;
- `tools` merges by Tool name;
- `null` disables one inherited Eval budget;
- `case.timeout: null` disables the complete inherited Eval policy;
- `null` is the preferred explicit inheritance override; and
- existing non-positive or non-finite values remain disabled for compatibility.

Normalization is semantic and JSON-portable. Missing fields remain absent.
Positive finite numbers use the same floored-millisecond normalization as
runtime budgets. An explicitly authored non-positive or non-finite number
canonicalizes to `null`, not omission, so it remains an override while all
disabled numeric spellings share one identity.

The inert definition retains `case.timeout: null` as a whole-policy clear.
Resolving that Case materializes `null` for exactly the scalar fields and named
Tool entries inherited from the Eval. The full resolved policy retains a
`totalMs` clear for identity and cell-deadline resolution; the task-context
projection omits `totalMs` but preserves every other materialized `null`. It
does not synthesize clears for fields or Tool names that were not inherited.
The canonical `toolBudgetMs()` resolver distinguishes an absent named override
from explicit `null`, so direct generation calls honor the same semantics.

Widening canonical timeout fields to include `null` is intentionally
source-breaking for consumers that read an optional field as `number` without
narrowing. It ships in the pre-1.0 minor release and is called out in the
changeset.

## Resolution against task timeouts

Resolution is one pure provider-neutral operation:

1. merge the Eval policy with the Case policy;
2. resolve each Tool's inherited `toolMs` and named override;
3. intersect the result with the task's own effective timeout; and
4. use the lower enabled value for each matching budget.

An Eval policy is a ceiling and never makes production execution more patient.
A disabled Eval budget contributes no ceiling; it does not disable a timeout
authored by the task itself. Core resolves the Eval/Case policy; a managed task
descriptor resolves its adapter-owned defaults, call options, and Variant
overrides, then clamps them against that policy. Core does not inspect
provider-specific task defaults.

The frozen `EvalTaskContext.timeout` carries a private, non-enumerable ownership
marker. `generate()` and `stream()` recognize the object as an Eval ceiling and
clamp it against their normally resolved timeout instead of applying ordinary
call-option replacement. The marker never enters definition, evidence, or wire
serialization; authored `null` values remain part of policy identity. Cloning
the timeout object drops its ceiling semantics; JSDoc examples therefore pass
it unchanged.

The resolved policy participates in planned-cell and task-evidence identity.
Changing a Case from 30 seconds to 5 seconds cannot reuse evidence created
under the looser policy. Exact evidence created under the same policy remains
reusable unless normal freshness rules require live execution.

## Generation signal

Public `generate()` and `stream()` call options gain:

```ts
/**
 * Abort signal for caller-owned cooperative cancellation.
 *
 * When combined with structured timeouts, the first cancellation source wins.
 */
readonly signal?: AbortSignal
```

The signal stays a call option. It is not added to general `ExecutionContext`,
prompt definitions, or global adapter state. Managed Eval descriptors pass
their engine-owned signal through this ordinary call seam. Adapters and Tools
continue to receive the composed signal through their existing contexts.

`TimeoutError` gains the standard cross-copy guard used by mature TypeScript
SDK errors:

```ts
static isInstance(error: unknown): error is TimeoutError
```

An unhandled canonical `TimeoutError` leaving either a managed or opaque task is
a `timed_out` Eval outcome. Code that catches and handles the error may continue
normally. Classification never parses error messages.

`generate.task()` and `stream.task()` remain cancellable production callables,
but `signal` is engine-owned when the same task is authored in an Eval Case.
Eval authoring derives a separate projection over the existing six-parameter
task type:

```ts
type EvalCaseCallOf<T> = IsManagedEvalTask<T> extends true
  ? Omit<CallOf<T>, 'signal'>
  : CallOf<T>
```

`IsManagedEvalTask` is an internal type predicate over the existing phantom
metadata. `EvaluateOptions`, `CaseOf`, and Variant call validation use the
derived Case projection; production task callability and `ManagedTaskTypes<T>`
inference remain unchanged.

AI task defaults also omit `signal`, because binding a one-shot `AbortSignal`
into a reusable task is neither portable nor identity-safe. Production callers
may still supply it per call. Type tests cover production cancellation, default
rejection, Case exclusion, opaque-call preservation, and unchanged required-key
arity.
