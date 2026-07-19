import type { CruxRunId, CruxSpanId, CruxTraceId } from "./contract";

/** Exact core-owned observability identity of the operation that produced a result. */
export interface OperationResultMeta {
  /** W3C trace containing the producing operation and its causal descendants. */
  readonly traceId: CruxTraceId;
  /** Exact Crux span that produced this result envelope. */
  readonly spanId: CruxSpanId;
}

/** Durable logical-run aggregate identity used to look up one observed run. */
export interface OperationRunRef {
  /** Logical Crux run, stable across durable suspend and resume segments. */
  readonly runId: CruxRunId;
  /** W3C trace containing this logical run. */
  readonly traceId: CruxTraceId;
}

type ExistingResultMeta<TResult> = TResult extends {
  readonly _meta?: infer TMeta;
}
  ? NonNullable<TMeta> extends object
    ? NonNullable<TMeta>
    : Record<never, never>
  : Record<never, never>;

/**
 * Add exact core-owned correlation while preserving provider result metadata.
 *
 * Reserved `traceId` and `spanId` fields are replaced with their Crux brands;
 * provider response identity remains a separate field such as `responseId`.
 */
export type WithOperationResultMeta<TResult extends object> =
  TResult extends unknown
    ? Omit<TResult, "_meta"> & {
        readonly _meta: Readonly<
          Omit<ExistingResultMeta<TResult>, keyof OperationResultMeta> &
            OperationResultMeta
        >;
      }
    : never;
