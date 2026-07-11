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
 * Common result fields returned by every completed media operation.
 *
 * Missing provider facts stay omitted and warnings always exists. `raw` is the
 * provider-owned response; Crux does not rewrite transport failures into this
 * result shape.
 */
export type CompletedOperationResult<TRaw = unknown, TMetadata = unknown, TWarning = unknown> = Readonly<{
  warnings: readonly TWarning[]
  providerMetadata?: TMetadata
  execution: OperationExecution
  raw: TRaw
}>

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
