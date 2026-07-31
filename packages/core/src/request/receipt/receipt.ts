/**
 * Small JSON-safe receipts for executed provider requests.
 *
 * @module
 */

import type { ModelCountingConfidence } from "../capacity/model-profile";
import type { RequestAdaptation, RequestWarning } from "./adaptations";
import type { RequestTokenBreakdown } from "../measure/breakdown";
import {
  requestInspection,
  retainRequestInspection,
  type RequestInspection,
  type RequestInspectionEvidence,
  type RequestSupportReceipt,
} from "./inspection";
import { emitRequestPlan } from "./observability";
import type { RequestHistoryContext } from "../history/source";

export type {
  RequestInspection,
  RequestSupportReceipt,
} from "./inspection";

let fallbackRequestId = 0;
const retryCounts = new WeakMap<RequestReceipt, { value: number }>();
const inspectionReaders = new WeakMap<
  RequestReceipt,
  () => RequestInspection
>();
const completedObservability = new WeakSet<RequestReceipt>();

/**
 * Executed-request evidence attached to one provider-call step.
 *
 * The enumerable fields are JSON-safe. `inspect()` is a non-enumerable live
 * convenience and never causes planning or provider side effects.
 *
 * @example
 * ```ts
 * const receipt = result.steps[0].request;
 * console.log(receipt.inputTokens, receipt.adaptations);
 * const inspection = await receipt.inspect();
 * ```
 */
export interface RequestReceipt {
  /** Unique identity for this sealed provider request. */
  readonly id: string;
  /** Concrete provider model selected for the request. */
  readonly model: string;
  /** Measured complete-request input tokens. */
  readonly inputTokens: number;
  /** Effective strict input maximum. */
  readonly maxInputTokens: number;
  /** Measurement confidence used for the fit decision. */
  readonly measurement: ModelCountingConfidence;
  /** Authorized deviations from exact contributor representations. */
  readonly adaptations: readonly RequestAdaptation[];
  /** Non-fatal planning warnings. */
  readonly warnings: readonly RequestWarning[];
  /** Previous provider request in the same managed loop. */
  readonly previousRequestId?: string;
  /** Redacted canonical history ownership used by this request. */
  readonly history?: {
    readonly source: RequestHistoryContext["source"];
    readonly policy: RequestHistoryContext["policy"];
    readonly revision?: string;
  };
  /** Inspect redacted evidence retained with this live receipt. */
  inspect(): Promise<RequestInspection>;
}

/** Fields used to create one immutable request receipt. @internal */
export interface CreateRequestReceiptInput {
  readonly id?: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly maxInputTokens: number;
  readonly measurement: ModelCountingConfidence;
  readonly breakdown: RequestTokenBreakdown;
  readonly safetyMarginTokens: number;
  readonly providerOverheadTokens: number;
  readonly retryCount?: number;
  readonly previousRequestId?: string;
  readonly warnings?: readonly RequestWarning[];
  readonly adaptations?: readonly RequestAdaptation[];
  readonly inspection?: RequestInspectionEvidence;
  readonly history?: RequestHistoryContext;
}

/** Create one immutable JSON-safe request receipt. @internal */
export function createRequestReceipt(
  input: CreateRequestReceiptInput,
): RequestReceipt {
  const id = input.id ?? createRequestId();
  const retryCount = { value: input.retryCount ?? 0 };
  const adaptations = Object.freeze([...(input.adaptations ?? [])]);
  let inspect = (): RequestInspection => {
    throw new TypeError("Request receipt inspection is not initialized.");
  };
  const receipt: RequestReceipt = {
    id,
    model: input.model,
    inputTokens: input.inputTokens,
    maxInputTokens: input.maxInputTokens,
    measurement: input.measurement,
    adaptations,
    warnings: Object.freeze([...(input.warnings ?? [])]),
    ...(input.previousRequestId
      ? { previousRequestId: input.previousRequestId }
      : {}),
    ...(input.history
      ? {
          history: Object.freeze({
            source: input.history.source,
            policy: input.history.policy,
            ...(input.history.sourceRevision
              ? { revision: input.history.sourceRevision }
              : {}),
          }),
        }
      : {}),
    inspect: async () => inspect(),
  };
  inspect = retainRequestInspection(id, () =>
    requestInspection({
      receipt,
      breakdown: input.breakdown,
      measurement: input.measurement,
      safetyMarginTokens: input.safetyMarginTokens,
      providerOverheadTokens: input.providerOverheadTokens,
      retryCount: retryCount.value,
      evidence: input.inspection,
    }),
  );
  Object.defineProperty(receipt, "inspect", {
    enumerable: false,
    value: receipt.inspect,
  });
  retryCounts.set(receipt, retryCount);
  inspectionReaders.set(receipt, inspect);
  emitRequestPlan(receipt, inspect(), "sealed");
  return Object.freeze(receipt);
}

/** Record adapter-reported transport retries without mutating the receipt. @internal */
export function recordRequestRetryCount(
  receipt: RequestReceipt,
  count: number | undefined,
): void {
  if (count !== undefined) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(
        "Adapter transportRetries must be a non-negative safe integer.",
      );
    }
    const state = retryCounts.get(receipt);
    if (state) state.value = count;
  }
  if (completedObservability.has(receipt)) return;
  const inspect = inspectionReaders.get(receipt);
  if (!inspect) return;
  completedObservability.add(receipt);
  emitRequestPlan(receipt, inspect(), "completed");
}

/** Create a unique request identity before planning or dispatch. @internal */
export function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `request_${uuid.replaceAll("-", "")}`;
  fallbackRequestId += 1;
  return `request_${Date.now().toString(36)}_${fallbackRequestId.toString(36)}`;
}
