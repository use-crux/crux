/**
 * Small JSON-safe receipts for executed provider requests.
 *
 * @module
 */

import type { ModelCountingConfidence } from "../capacity/model-profile";
import type { RequestTokenBreakdown } from "../measure/breakdown";
import type { RequestAdaptation, RequestWarning } from "./adaptations";
import { supportRequestReceipt } from "./support";
import {
  preparationDecision,
  type PreparationDecisionInspection,
} from "../prepare/journal";

let fallbackRequestId = 0;
const retryCounts = new WeakMap<RequestReceipt, { value: number }>();

/** Redacted linked support-call facts retained with live inspection. */
export interface RequestSupportReceipt {
  /** Support request identity linked from the adaptation. */
  readonly id: string;
  /** Concrete support model. */
  readonly model: string;
  /** Measured support-call input tokens. */
  readonly inputTokens: number;
  /** Effective support-call input maximum. */
  readonly maxInputTokens: number;
  /** Support-call measurement confidence. */
  readonly measurement: ModelCountingConfidence;
}

/** Retained breakdown-only inspection available for a live request receipt. */
export interface RequestInspection {
  /** Request identity shared with the small receipt. */
  readonly id: string;
  /** Redacted token attribution by contribution class. */
  readonly breakdown: RequestTokenBreakdown;
  /** Measurement confidence used for the fit decision. */
  readonly measurement: ModelCountingConfidence;
  /** Confidence-based safety margin reserved from model capacity. */
  readonly safetyMarginTokens: number;
  /** Provider framing allowance reserved from model capacity. */
  readonly providerOverheadTokens: number;
  /** Number of provider transport retries reported for the sealed request. */
  readonly retryCount: number;
  /** Receipted support calls linked from selected adaptations. */
  readonly supportRequests: readonly RequestSupportReceipt[];
  /** Accepted content-free preparation decision for this provider call. */
  readonly preparation?: PreparationDecisionInspection;
  /** Evidence-retention limitation until durable inspection is wired. */
  readonly retention: "requires observability retention";
}

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
}

/** Create one immutable JSON-safe request receipt. @internal */
export function createRequestReceipt(
  input: CreateRequestReceiptInput,
): RequestReceipt {
  const id = input.id ?? createRequestId();
  const retryCount = { value: input.retryCount ?? 0 };
  const adaptations = Object.freeze([...(input.adaptations ?? [])]);
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
    inspect: async () => {
      const preparation = preparationDecision(receipt);
      return Object.freeze({
        id,
        breakdown: input.breakdown,
        measurement: input.measurement,
        safetyMarginTokens: input.safetyMarginTokens,
        providerOverheadTokens: input.providerOverheadTokens,
        retryCount: retryCount.value,
        supportRequests: linkedSupportRequests(adaptations),
        ...(preparation ? { preparation } : {}),
        retention: "requires observability retention" as const,
      });
    },
  };
  Object.defineProperty(receipt, "inspect", {
    enumerable: false,
    value: receipt.inspect,
  });
  retryCounts.set(receipt, retryCount);
  return Object.freeze(receipt);
}

function linkedSupportRequests(
  adaptations: readonly RequestAdaptation[],
): readonly RequestSupportReceipt[] {
  const ids = new Set(
    adaptations.flatMap((adaptation) =>
      adaptation.supportRequestIds ??
      (adaptation.supportRequestId
        ? [adaptation.supportRequestId]
        : []),
    ),
  );
  return Object.freeze(
    [...ids].flatMap((id) => {
      const linked = supportRequestReceipt(id);
      return linked
        ? [
            Object.freeze({
              id: linked.id,
              model: linked.model,
              inputTokens: linked.inputTokens,
              maxInputTokens: linked.maxInputTokens,
              measurement: linked.measurement,
            }),
          ]
        : [];
    }),
  );
}

/** Record adapter-reported transport retries without mutating the receipt. @internal */
export function recordRequestRetryCount(
  receipt: RequestReceipt,
  count: number | undefined,
): void {
  if (count === undefined) return;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(
      "Adapter transportRetries must be a non-negative safe integer.",
    );
  }
  const state = retryCounts.get(receipt);
  if (state) state.value = count;
}

/** Create a unique request identity before planning or dispatch. @internal */
export function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `request_${uuid.replaceAll("-", "")}`;
  fallbackRequestId += 1;
  return `request_${Date.now().toString(36)}_${fallbackRequestId.toString(36)}`;
}
