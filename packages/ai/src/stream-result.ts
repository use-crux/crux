/**
 * Publish an AI SDK stream handle as a Crux logical stream (RFC #173).
 *
 * The SDK result object stops here. Its parts are translated into the closed
 * logical vocabulary and driven through core's publication seam, so every
 * managed `stream()` — native or SDK, gated or not — has one result shape and
 * one set of publication guarantees. Nothing downstream can reach the SDK
 * object, which is what removes the Safety bypass a public `.raw` was.
 *
 * @module
 */

import type {
  ExecutorStreamHandle,
  ExecutorStreamCompletionPayload,
  ExecutorStreamMeta,
  LogicalStreamCallbacks,
  PublishedStreamEvent,
  StreamCompletion,
  StreamResult,
} from "@use-crux/core/adapter";
import type { GenerationMeta } from "@use-crux/core";
import {
  createCanonicalPartialProjector,
  createResultAccumulator,
  normalizeAdapterCallError,
  publishOrdinaryStream,
} from "@use-crux/core/adapter";
import { isPolicyTerminal } from "@use-crux/core/safety";
import {
  attachRoutingToError,
  markRoutingMidStreamFailure,
} from "@use-crux/core/routing";
import { mapAiSdkError, mapAiSdkFinishReason } from "./normalized-outcome";
import { logicalEventsFor } from "./logical-events";
import type { CruxRunId } from "@use-crux/core/observability";

/** The stream surfaces an AI SDK result exposes, all optional across versions. */
interface AiStreamLike {
  readonly fullStream?: AsyncIterable<unknown>;
  readonly textStream?: AsyncIterable<string>;
}

/**
 * Build a canonical Crux logical stream from an AI SDK executor handle.
 *
 * @param handle - The executor handle for one managed stream operation.
 * @param callbacks - Caller callbacks over the PUBLISHED sequence. They are
 *   attached here, at the publication seam, and never to a physical attempt.
 */
export function createAiStreamResult<TRawStream, TOutput = unknown, TPartial = unknown>(
  handle: ExecutorStreamHandle<TRawStream> & { readonly runId: CruxRunId },
  callbacks: LogicalStreamCallbacks<TOutput, TPartial> = {},
): StreamResult<TOutput, TPartial> {
  let completionMeta: Promise<ExecutorStreamMeta | undefined> | undefined;
  const getMeta = (): Promise<ExecutorStreamMeta | undefined> => {
    completionMeta ??= handle.completion();
    void completionMeta.catch(() => undefined);
    return completionMeta;
  };

  async function* events(): AsyncIterable<PublishedStreamEvent<TPartial>> {
    const partials = handle.structured
      ? createCanonicalPartialProjector()
      : undefined;
    try {
      for await (const event of readParts<TPartial>(handle.raw)) {
        // A terminal stage can still rewrite or strip these AFTER the provider
        // emitted them, so they are republished from the guarded completion
        // below instead of progressively here. Without such a binding nothing
        // downstream can change them and they release progressively (law 5).
        //
        // Reasoning needs this as much as media: the live text transform gates
        // only `text-delta`, while `model.output.text` runs over reasoning parts
        // at completion — so an ungated reasoning delta could stream a value the
        // operation then redacts (RFC #173, law 2).
        if (event.type === "media" && handle.deferMedia) continue;
        if (event.type === "reasoning-delta" && handle.deferReasoning) continue;
        yield event;
        if (event.type !== "text-delta") continue;
        const partial = partials?.push(event.text);
        if (partial) {
          yield { type: "partial-output", value: partial.value as TPartial };
        }
      }
      if (handle.deferMedia || handle.deferReasoning) {
        yield* guardedDeferred<TPartial>(await getMeta(), {
          media: handle.deferMedia === true,
          reasoning: handle.deferReasoning === true,
        });
      }
    } catch (error) {
      throw normalizeStreamError(error, handle.routing);
    }
  }

  const completion = async (): Promise<StreamCompletion<TOutput>> => {
    try {
      const meta = await getMeta();
      return {
        ...completionFromMeta(meta, handle.routing, handle._meta),
        runId: handle.runId,
      } as StreamCompletion<TOutput>;
    } catch (error) {
      throw normalizeStreamError(error, handle.routing);
    }
  };

  return publishOrdinaryStream<TOutput, TPartial>({
    runId: handle.runId,
    meta: handle._meta,
    events: events(),
    completion,
    ...(callbacks.onChunk ? { onChunk: callbacks.onChunk } : {}),
    ...(callbacks.onFinish ? { onFinish: callbacks.onFinish } : {}),
    ...(callbacks.onError ? { onError: callbacks.onError } : {}),
    ...(handle.abort ? { onCancel: handle.abort } : {}),
    ...(handle.signal ? { signal: handle.signal } : {}),
  });
}

/**
 * Republish deferred content from the GUARDED completion.
 *
 * @remarks
 * Reached only for kinds a terminal stage could still change, so this is the
 * FIRST point at which they are final. Anything the guard stripped is simply
 * absent from `content` and therefore never published; anything it rewrote is
 * published only in its rewritten form.
 */
function* guardedDeferred<TPartial>(
  meta: ExecutorStreamMeta | undefined,
  deferred: { readonly media: boolean; readonly reasoning: boolean },
): Generator<PublishedStreamEvent<TPartial>> {
  for (const part of meta?.content ?? []) {
    if (part.type === "text" || part.type === "tool-call") continue;
    if (part.type === "reasoning") {
      if (deferred.reasoning) yield { type: "reasoning-delta", text: part.text };
      continue;
    }
    if (deferred.media) yield { type: "media", part };
  }
}

/**
 * Translate the SDK result's part stream into logical events.
 *
 * @remarks
 * `fullStream` is preferred because it is the only surface carrying reasoning,
 * tools, sources, and media. A result exposing only `textStream` still publishes
 * a correct — if text-only — logical stream rather than silently publishing
 * nothing.
 */
async function* readParts<TPartial>(
  raw: unknown,
): AsyncIterable<PublishedStreamEvent<TPartial>> {
  const stream = raw as AiStreamLike | undefined;
  if (stream?.fullStream) {
    for await (const part of stream.fullStream) {
      yield* logicalEventsFor<TPartial>(part);
    }
    return;
  }
  for await (const text of stream?.textStream ?? []) {
    if (text !== "") yield { type: "text-delta", text };
  }
}

/**
 * Normalize a raw AI SDK stream failure into a {@link CruxAdapterError} and
 * re-attach routing metadata so a mid-stream error surfaces the shared
 * provider-error taxonomy instead of a raw SDK/provider exception.
 *
 * Applied both to part-stream iteration errors and to completion failures, so
 * a failed stream never leaks an un-normalized error to either consumer.
 */
function normalizeStreamError(
  error: unknown,
  routing: ExecutorStreamHandle<unknown>["routing"],
): unknown {
  if (isPolicyTerminal(error)) return error;
  // A cancellation is recorded as cancellation, never reclassified as a
  // provider fault.
  if (error instanceof DOMException && error.name === "AbortError") return error;
  const normalized = normalizeAdapterCallError(error, {
    providerId: "ai-sdk",
    mapError: mapAiSdkError,
  });
  if (routing === undefined) return normalized;
  return attachRoutingToError(normalized, markRoutingMidStreamFailure(routing));
}

function completionFromMeta(
  meta: ExecutorStreamMeta | undefined,
  routing: ExecutorStreamHandle<unknown>["routing"],
  operation: ExecutorStreamHandle<unknown>["_meta"],
) {
  const accumulator = createResultAccumulator();
  const text = meta?.text ?? "";
  accumulator.addStep({
    content: meta?.content ?? [{ type: "text", text }],
    ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
    ...(meta?.toolCalls !== undefined ? { toolCalls: meta.toolCalls } : {}),
    finishReason: mapAiSdkFinishReason(meta?.finishReason),
    responseId: meta?.responseId,
    modelId: meta?.actualModelId,
    ...(meta?.warnings !== undefined ? { warnings: meta.warnings } : {}),
    ...(meta?.providerMetadata !== undefined
      ? { providerMetadata: meta.providerMetadata }
      : {}),
  });
  const payload = accumulator.finalizeCompletion({
    messages: meta?.messages ? [...meta.messages] : [],
    ...(meta?.object !== undefined ? { object: meta.object } : {}),
    ...(meta?.cost !== undefined ? { cost: meta.cost } : {}),
    ...(routing !== undefined ? { routing } : {}),
    // Present only when the operation spanned several billable attempts; it then
    // replaces the step-derived totals (RFC #173, law 7).
    ...(meta?.logicalTotals !== undefined
      ? { logicalTotals: meta.logicalTotals }
      : {}),
    _meta: completionMetadata(meta),
  });
  return {
    ...payload,
    _meta: Object.freeze({ ...payload._meta, ...operation }),
  };
}

type CanonicalCompletionMeta = GenerationMeta &
  Pick<ExecutorStreamCompletionPayload, "semanticCache" | "streaming">;

const COMPLETION_ENVELOPE_FIELDS = new Set([
  "_meta",
  "runId",
  "text",
  "object",
  "content",
  "messages",
  "warnings",
  "providerMetadata",
  // Consumed by the envelope as the logical total; not a `_meta` fact.
  "logicalTotals",
]);

function completionMetadata(
  meta: ExecutorStreamMeta | undefined,
): CanonicalCompletionMeta {
  if (!meta) return {};
  const completion: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!COMPLETION_ENVELOPE_FIELDS.has(key) && value !== undefined) {
      completion[key] = value;
    }
  }
  return completion as CanonicalCompletionMeta;
}
