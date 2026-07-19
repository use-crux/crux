/**
 * Flow result boundary helpers.
 *
 * Durable flow state carries replay data, never invocation-local result
 * identity. Public outcomes are finalized from the explicit current
 * `flow.run` span immediately before return.
 *
 * @module
 */

import type { OperationResultMeta } from "../observability";
import { withOperationResultMeta } from "../observability/internal/result-meta";
import type { FlowResult, FlowResultPayload } from "./types";

type WithoutResultMeta<T> = T extends unknown ? Omit<T, "_meta"> : never;

/** Minimal explicit span identity accepted by the flow result boundary. */
interface FlowResultOwner {
  readonly traceId: OperationResultMeta["traceId"];
  readonly spanId: OperationResultMeta["spanId"];
}

/** Capture the exact operation pair from an explicit `flow.run` owner. */
export function flowResultOperation(
  owner: FlowResultOwner,
): OperationResultMeta {
  return { traceId: owner.traceId, spanId: owner.spanId };
}

/** Construct an unobserved completed flow payload. */
export function completedFlowResultPayload<T>(
  output: T,
  flowId: string,
): FlowResultPayload<T> {
  return { status: "completed", output, flowId };
}

/** Construct an unobserved suspended flow payload. */
export function suspendedFlowResultPayload<T>(
  flowId: string,
  suspendedAt: string,
): FlowResultPayload<T> {
  return { status: "suspended", flowId, suspendedAt };
}

/** Construct an unobserved cancelled flow payload. */
export function cancelledFlowResultPayload<T>(
  flowId: string,
  cancelReason?: string,
): FlowResultPayload<T> {
  return { status: "cancelled", flowId, cancelReason };
}

/** Construct an unobserved expired flow payload. */
export function expiredFlowResultPayload<T>(
  flowId: string,
  suspendedAt: string,
): FlowResultPayload<T> {
  return { status: "expired", flowId, suspendedAt };
}

/**
 * Remove legacy invocation metadata from a flow value without mutating it.
 *
 * Arrays and primitive user values are returned unchanged. Object envelopes
 * are shallow-cloned only when they own an `_meta` field.
 */
export function stripFlowResultMeta<T extends object>(
  value: T,
): WithoutResultMeta<T>;
export function stripFlowResultMeta<T>(value: T): T;
export function stripFlowResultMeta(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(value, "_meta")
  ) {
    return value;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  delete descriptors._meta;
  const stripped = Object.create(Object.getPrototypeOf(value)) as object;
  Object.defineProperties(stripped, descriptors);
  if (!Object.isExtensible(value)) Object.preventExtensions(stripped);
  return stripped;
}

/** Finalize a flow payload with the exact current `flow.run` operation. */
export function finalizeFlowResult<T>(
  payload: FlowResultPayload<T>,
  operation: OperationResultMeta,
): FlowResult<T> {
  return withOperationResultMeta(stripFlowResultMeta(payload), operation);
}
