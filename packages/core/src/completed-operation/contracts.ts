import type { SafetyAudit } from '../safety/audit'
import type { WithOperationResultMeta } from '../observability/result-meta'

/** Timeout budgets shared by bounded, non-streaming media operations. */
export type OperationTimeout = Readonly<{
  /** Whole public operation, including retries and composed child calls. */
  totalMs?: number
  /** One provider attempt or composed child call. */
  stepMs?: number
}>

/** Provider-call facts for one completed media result. */
export type OperationExecution =
  | Readonly<{ kind: 'native'; calls: number }>
  | Readonly<{ kind: 'composed'; calls: number; operations: readonly string[] }>

/**
 * Provider-authored facts for one completed media operation.
 *
 * Missing provider facts stay omitted and warnings always exists. `raw` is the
 * provider-owned response. Adapter validation returns this ID-free payload;
 * the shared Core runner owns correlation and creates the public result.
 */
export type CompletedOperationPayload<TRaw = unknown, TMetadata = unknown, TWarning = unknown> = Readonly<{
  warnings: readonly TWarning[]
  providerMetadata?: TMetadata
  execution: OperationExecution
  raw: TRaw
  /**
   * Applied Safety decisions for canonical fields.
   *
   * Absent when no entry was recorded. Provider-native `raw`, metadata, and
   * warnings are preserved but are not covered by this audit.
   */
  safety?: SafetyAudit
}>

/** @internal Constraint that prevents provider definitions from returning observed results. */
export type CompletedOperationProviderPayload<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = CompletedOperationPayload<TRaw, TMetadata, TWarning> &
  Readonly<{ _meta?: never }>

/**
 * Public completed-media result correlated to its exact producing media span.
 *
 * The shared runner adds `_meta` after provider validation and before success
 * reporting. Provider packages must construct {@link CompletedOperationPayload}
 * instead.
 */
export type CompletedOperationResult<TRaw = unknown, TMetadata = unknown, TWarning = unknown> =
  WithOperationResultMeta<CompletedOperationPayload<TRaw, TMetadata, TWarning>>

/** Validate completed-operation timeout budgets before provider I/O. */
export function validateOperationTimeout(timeout: OperationTimeout | undefined): void {
  if (timeout === undefined) return
  positiveMilliseconds(timeout.totalMs, 'totalMs')
  positiveMilliseconds(timeout.stepMs, 'stepMs')
}

/** Validate and freeze provider-call facts supplied by an operation. */
export function validateOperationExecution(execution: OperationExecution): OperationExecution {
  if (!Number.isSafeInteger(execution.calls) || execution.calls <= 0) {
    throw new RangeError('Completed operation execution calls must be a positive safe integer.')
  }
  if (execution.kind === 'native') return Object.freeze({ ...execution })
  if (execution.operations.length === 0 || execution.operations.some((operation) => !operation.trim())) {
    throw new TypeError('Composed operation execution must name every child operation.')
  }
  return Object.freeze({ ...execution, operations: Object.freeze([...execution.operations]) })
}

function positiveMilliseconds(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`Completed operation timeout.${name} must be positive finite milliseconds.`)
  }
}
