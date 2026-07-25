/** Public managed-stream result contracts. */

import type { CruxRunId, WithOperationResultMeta } from "../observability";
import type { GenerateResultPayload } from "./result-accumulator";

/**
 * Provider and policy facts assembled when a managed stream completes.
 *
 * This payload exists before the owning `generation.stream` operation adds
 * its trace/span identity.
 */
export type StreamCompletionPayload<TOutput = unknown> = Omit<
  GenerateResultPayload<never, TOutput>,
  "raw"
>;

/** Canonical observed completion resolved by managed `stream()` results. */
export type StreamCompletion<TOutput = unknown> = WithOperationResultMeta<
  StreamCompletionPayload<TOutput>
> & Readonly<{ runId: CruxRunId }>;
