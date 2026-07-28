import type { CompletedOperationProviderPayload } from "../../completed-operation/contracts";
import { withAbortSignal } from "../../generation/timeout";
import type { Safety } from "../../safety/session";
import type {
  StreamingOperationContext,
  StreamingOperationDefinition,
} from "./definition";
import {
  finalizeStreamingOutput,
  type FinalizedStreamingOutput,
} from "./safety/final";
import {
  guardImageStreamCandidate,
  type ImageStreamCandidate,
} from "./safety/image";
import type { StreamingAttemptObservation } from "./observability";
import { describeStreamingEvent } from "./progress";

/** Drive one replaceable physical media stream without publishing its final. */
export async function runStreamingAttempt<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends CompletedOperationProviderPayload,
  TReport,
>(
  options: Readonly<{
    definition: StreamingOperationDefinition<
      TModel,
      TInput,
      TNormalized,
      TNativeEvent,
      TNativeResult,
      TEvent,
      TResult,
      TReport
    >;
    provider: string;
    operation: "streamImage" | "streamSpeech";
    model: TModel;
    normalized: TNormalized;
    signal: AbortSignal;
    safety: Safety | undefined;
    holdDeltas: boolean;
    publish(event: TEvent): boolean;
    policyError(error: unknown): void;
    call<T>(operation: string, start: () => Promise<T>): Promise<T>;
    observation?: StreamingAttemptObservation;
  }>,
): Promise<FinalizedStreamingOutput<TResult>> {
  const context: StreamingOperationContext<TModel> = {
    provider: options.provider,
    operation: options.operation,
    model: options.model,
  };
  const source = await options.definition.open(options.normalized, {
    ...context,
    signal: options.signal,
    call: options.call,
  });
  const heldDeltas: TEvent[] = [];
  void source.completion.catch(() => undefined);

  try {
    const [, native] = await withAbortSignal(
      () =>
        Promise.all([
          driveSource(
            source.events,
            source.map,
            async (event) => {
              const descriptor = describeStreamingEvent(event);
              if (descriptor) options.observation?.candidate(descriptor);
              if (options.holdDeltas && isIncompleteDelta(event)) {
                heldDeltas.push(event);
                return;
              }
              let guarded: TEvent | undefined;
              try {
                guarded =
                  options.operation === "streamImage"
                    ? ((await guardImageStreamCandidate(
                        event as unknown as ImageStreamCandidate,
                        options.safety,
                        describeModel(options.model),
                      )) as unknown as TEvent | undefined)
                    : event;
              } catch (error) {
                options.policyError(error);
                throw error;
              }
              if (guarded !== undefined && options.publish(guarded)) {
                options.observation?.published();
              }
            },
            options.signal,
          ),
          source.completion,
        ]),
      options.signal,
    );
    try {
      const finalized = await finalizeStreamingOutput(
        options.operation,
        options.definition.validate(native, options.normalized, context),
        options.safety,
        describeModel(options.model),
      );
      for (const event of finalized.events) {
        const descriptor = describeStreamingEvent(event);
        if (descriptor) options.observation?.candidate(descriptor);
      }
      return finalized;
    } catch (error) {
      options.policyError(error);
      throw error;
    }
  } finally {
    heldDeltas.length = 0;
  }
}

function isIncompleteDelta(event: unknown): boolean {
  if (typeof event !== "object" || event === null || !("type" in event)) {
    return false;
  }
  return event.type === "image-delta" || event.type === "audio-delta";
}

async function driveSource<TNativeEvent, TEvent>(
  events: AsyncIterable<TNativeEvent>,
  map: (event: TNativeEvent) => TEvent | readonly TEvent[] | undefined,
  publish: (event: TEvent) => void | Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  let exhausted = false;
  let closing = false;
  const close = (): void => {
    if (exhausted || closing || iterator.return === undefined) return;
    closing = true;
    void iterator.return().catch(() => undefined);
  };
  const onAbort = (): void => close();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        exhausted = true;
        return;
      }
      const mapped = map(next.value);
      if (mapped === undefined) continue;
      if (Array.isArray(mapped)) {
        for (const event of mapped) await publishCandidate(event, publish);
      } else {
        await publishCandidate(mapped as TEvent, publish);
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    close();
  }
}

async function publishCandidate<TEvent>(
  event: TEvent,
  publish: (event: TEvent) => void | Promise<void>,
): Promise<void> {
  if (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event.type === "start" ||
      event.type === "finish" ||
      event.type === "image" ||
      event.type === "audio")
  ) {
    throw new TypeError(
      `Provider streaming mappers cannot emit Core-owned '${event.type}' events.`,
    );
  }
  await publish(event);
}

function describeModel(model: unknown): string | undefined {
  if (typeof model === "string") return model;
  if (typeof model !== "object" || model === null) return undefined;
  const value = model as { readonly modelId?: unknown; readonly id?: unknown };
  if (typeof value.modelId === "string") return value.modelId;
  return typeof value.id === "string" ? value.id : undefined;
}
