/** Runtime-backed Signal publication selection. */

import type { JsonValue } from "../storage";
import { getHooks } from "../runtime/runtime";
import { createRuntimeWithHostContext } from "../runtime/api/host-context";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../runtime/api/target-registry";
import type { ProcessLocalSignalState } from "./local-subscriptions";
import type {
  SignalOccurrence,
  SignalPublishOptions,
  SignalPublishReceipt,
} from "./publication";
import {
  createDurableSignalOccurrenceId,
  hashSignalIdempotencyKey,
} from "./identity";
import { hasActiveEvalExecutionScope } from "../eval/internal/scope";
import { decodeSignalPayload } from "../runtime/reactive/payload-codec";

interface PublishAcceptedSignalInput<
  TId extends string,
  TPayload extends JsonValue,
> {
  readonly signalId: TId;
  readonly payload: TPayload;
  readonly options?: SignalPublishOptions;
  readonly local: ProcessLocalSignalState<TId, TPayload>;
}

/** Publish through Runtime when durable consumers are armed. @internal */
export async function publishAcceptedSignal<
  TId extends string,
  TPayload extends JsonValue,
>(
  input: PublishAcceptedSignalInput<TId, TPayload>,
): Promise<SignalPublishReceipt<TId>> {
  const localReplay = input.local.replay(input.payload, input.options);
  if (localReplay !== undefined) return localReplay;

  const runtimeDefinition = getHooks().runtimeEngine;
  if (!runtimeDefinition)
    return input.local.publish(input.payload, input.options);

  const acceptedAt = new Date();
  const occurrenceId = createDurableSignalOccurrenceId();
  const runtimeRef: RuntimeTargetRuntimeRef = {};
  const runtime = createRuntimeWithHostContext({
    runtime: runtimeDefinition,
    targets: runtimeTargetMap(runtimeRef),
    startMaintenance: false,
  });
  runtimeRef.current = runtime;

  try {
    const result = await runtime.kernel.publishSignal({
      namespace: runtime.namespace,
      occurrenceId,
      signalId: input.signalId,
      payload: input.payload,
      acceptedAt: acceptedAt.toISOString(),
      ...(hasActiveEvalExecutionScope() ? { executionScope: "eval" } : {}),
      ...(input.options?.idempotencyKey === undefined
        ? {}
        : {
            idempotencyHash: hashSignalIdempotencyKey(
              input.signalId,
              input.options.idempotencyKey,
            ),
          }),
    });
    if (!result.accepted) {
      runtime.dispose();
      return input.local.publish(input.payload, {
        ...input.options,
        occurrenceId,
        acceptedAt,
      });
    }

    const occurrence = publicOccurrence<TId, TPayload>(result.occurrence);
    if (!result.replayed) input.local.notify(occurrence);
    if (result.outboxCount > 0) {
      void runtime.dispatcher
        .nudge()
        .catch(() => reportDispatchFailure(occurrence))
        .finally(() => runtime.dispose());
    } else {
      runtime.dispose();
    }
    return Object.freeze({
      occurrenceId: occurrence.id,
      signalId: occurrence.signalId,
      acceptedAt: new Date(occurrence.acceptedAt),
      guarantee: "durable" as const,
    });
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

function reportDispatchFailure(
  occurrence: SignalOccurrence<string, JsonValue>,
): void {
  try {
    console.error(
      "[crux] durable Signal wake dispatch failed after publication acceptance.",
      Object.freeze({
        code: "signal_dispatch_failed",
        signalId: occurrence.signalId,
        occurrenceId: occurrence.id,
      }),
    );
  } catch {
    // Diagnostics are fail-open; the durable outbox still owns retry.
  }
}

function publicOccurrence<
  TId extends string,
  TPayload extends JsonValue,
>(occurrence: {
  readonly occurrenceId: string;
  readonly signalId: string;
  readonly payload: JsonValue;
  readonly payloadCodec?: string;
  readonly acceptedAt: string;
}): SignalOccurrence<TId, TPayload> {
  return Object.freeze({
    id: occurrence.occurrenceId,
    signalId: occurrence.signalId as TId,
    payload: decodeSignalPayload(
      occurrence.payload,
      occurrence.payloadCodec,
    ) as TPayload,
    acceptedAt: new Date(occurrence.acceptedAt),
  });
}
