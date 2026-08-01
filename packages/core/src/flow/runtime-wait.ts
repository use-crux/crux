/** Runtime-backed event and static Signal wait execution. */

import type { JsonValue } from "../storage";
import { runtimeRequiredError } from "../runtime/api/runtime-required";
import {
  decodeSignalOccurrence,
  isStaticSignalSource,
  signalSourceId,
  signalSourceMatch,
  signalSourcePredicate,
  type StaticSignalSource,
} from "../signal/source";
import {
  FlowExpiredError,
  FlowSuspendedError,
  type FlowWaitForEvent,
  type FlowWaitForOptions,
  type FlowWaitForSignalOptions,
} from "./types";
import {
  runtimeTimeoutMatches,
  type RuntimeFlowExecution,
} from "./runtime-engine";
import { suspendDeliveryKey } from "./suspend-state";

interface RuntimeWaitInput<TPayload> {
  readonly source: string | FlowWaitForEvent<TPayload> | StaticSignalSource;
  readonly options?: FlowWaitForOptions | FlowWaitForSignalOptions;
  readonly occurrence: number;
  readonly isResume: boolean;
  readonly execution?: RuntimeFlowExecution;
}

/** Resolve replay or throw the lifecycle control for one Runtime wait. */
export function executeRuntimeWait<TPayload>(
  input: RuntimeWaitInput<TPayload>,
): TPayload {
  const event = normalizeWaitSource(input.source);
  const signalSource = staticSignalSource(input.source);
  const signalId = signalSource ? signalSourceId(signalSource) : undefined;
  const signalMatch = signalSource
    ? signalSourceMatch(signalSource)
    : undefined;
  const signalPredicate = signalSource
    ? signalSourcePredicate(signalSource)
    : undefined;
  const suspendPoint = `waitFor:${event.name}`;
  const deliveryKey = suspendDeliveryKey(input.occurrence, suspendPoint);
  input.execution?.fingerprint.observe(`waitFor:${event.name}`);
  const replayPayload = input.execution
    ? deliveredRuntimePayload(
        input.execution.deliveredPayloads,
        deliveryKey,
        suspendPoint,
      )
    : undefined;

  if (input.isResume && replayPayload !== undefined) {
    if (!signalId) return validateEventPayload(event, replayPayload);
    const occurrence = decodeSignalOccurrence(replayPayload, signalId);
    if (signalPredicate?.(occurrence.payload) !== false) {
      return occurrence as TPayload;
    }
  }
  if (input.execution && runtimeTimeoutMatches(input.execution, suspendPoint)) {
    throw new FlowExpiredError(suspendPoint);
  }
  if (!input.execution) throw runtimeRequiredError({ api: "flow.waitFor()" });

  throw new FlowSuspendedError(
    suspendPoint,
    { timeout: input.options?.timeout },
    {
      eventName: event.name,
      ...(signalId ? { signalId } : {}),
      ...(signalMatch === undefined ? {} : { signalMatch }),
      ...(signalPredicate ? { signalPredicate: true } : {}),
      match:
        input.options && "match" in input.options
          ? (input.options.match ?? {})
          : {},
      fingerprint: `waitFor:${event.name}`,
    },
  );
}

function normalizeWaitSource<TPayload>(
  source: string | FlowWaitForEvent<TPayload> | StaticSignalSource,
): FlowWaitForEvent<TPayload> {
  if (typeof source === "string") return { name: source };
  if (isStaticSignalSource(source)) return { name: signalSourceId(source) };
  return source;
}

function staticSignalSource<TPayload>(
  source: string | FlowWaitForEvent<TPayload> | StaticSignalSource,
): StaticSignalSource | undefined {
  return isStaticSignalSource(source) ? source : undefined;
}

function validateEventPayload<TPayload>(
  event: FlowWaitForEvent<TPayload>,
  payload: JsonValue,
): TPayload {
  return event.schema ? event.schema.parse(payload) : (payload as TPayload);
}

/** Select a replay payload by exact occurrence key, then legacy label. */
export function deliveredRuntimePayload(
  deliveredPayloads: ReadonlyMap<string, JsonValue>,
  primaryKey: string,
  fallbackKey: string,
): JsonValue | undefined {
  if (deliveredPayloads.has(primaryKey))
    return deliveredPayloads.get(primaryKey);
  if (deliveredPayloads.has(fallbackKey))
    return deliveredPayloads.get(fallbackKey);
  return undefined;
}
