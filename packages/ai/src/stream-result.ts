/**
 * Canonical stream result projection for AI SDK stream handles.
 *
 * AI SDK stream results already own their public stream iterables. This module
 * exposes those iterables through Crux's adapter-neutral `StreamResult` while
 * preserving the SDK object under `.raw`.
 *
 * @module
 */

import type {
  ExecutorStreamHandle,
  ExecutorStreamCompletionPayload,
  ExecutorStreamMeta,
  StreamResult,
} from "@use-crux/core/adapter";
import type { GenerationMeta } from "@use-crux/core";
import { createResultAccumulator } from "@use-crux/core/adapter";
import { normalizeAdapterCallError } from "@use-crux/core/adapter";
import { isPolicyTerminal } from "@use-crux/core/safety";
import {
  attachRoutingToError,
  markRoutingMidStreamFailure,
} from "@use-crux/core/routing";
import { mapAiSdkError, mapAiSdkFinishReason } from "./normalized-outcome";
import type { CruxRunId } from "@use-crux/core/observability";

interface AiTextStreamLike {
  readonly textStream?: AsyncIterable<string>;
}

/** Build a canonical Crux stream result from an AI SDK executor handle. */
export function createAiStreamResult<TRawStream>(
  handle: ExecutorStreamHandle<TRawStream> & { readonly runId: CruxRunId },
): StreamResult<TRawStream> {
  let resolveStream: (() => void) | undefined;
  let rejectStream: ((error: unknown) => void) | undefined;
  const streamFinished = new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });
  void streamFinished.catch(() => undefined);
  const streamFailure = streamFinished.then<never>(
    () => new Promise<never>(() => undefined),
  );
  void streamFailure.catch(() => undefined);
  const textStream = trackTextStream(readTextStream(handle.raw), {
    routing: handle.routing,
    resolveStream: () => resolveStream?.(),
    rejectStream: (error) => rejectStream?.(error),
  });
  const completion = (async () => {
    try {
      if (handle.routing !== undefined) {
        await streamFinished;
      }
      const meta = await Promise.race([
        handle.completion(),
        streamFailure,
      ]);
      return {
        ...completionFromMeta(meta, handle.routing, handle._meta),
        runId: handle.runId,
      };
    } catch (error) {
      throw normalizeStreamError(error, handle.routing);
    }
  })();
  void completion.catch(() => undefined);

  return {
    runId: handle.runId,
    textStream,
    raw: handle.raw,
    _meta: handle._meta,
    completion,
  };
}

function readTextStream(raw: unknown): AsyncIterable<string> {
  const stream = (raw as AiTextStreamLike | undefined)?.textStream;
  return stream ?? emptyTextStream();
}

async function* emptyTextStream(): AsyncIterable<string> {}

async function* trackTextStream(
  source: AsyncIterable<string>,
  options: {
    readonly routing: ExecutorStreamHandle<unknown>["routing"];
    readonly resolveStream: () => void;
    readonly rejectStream: (error: unknown) => void;
  },
): AsyncIterable<string> {
  try {
    for await (const delta of source) {
      yield delta;
    }
    options.resolveStream();
  } catch (error) {
    const normalized = normalizeStreamError(error, options.routing);
    options.rejectStream(normalized);
    throw normalized;
  }
}

/**
 * Normalize a raw AI SDK stream failure into a {@link CruxAdapterError} and
 * re-attach routing metadata so a mid-stream error surfaces the shared
 * provider-error taxonomy instead of a raw SDK/provider exception.
 *
 * Applied both to text-stream iteration errors and to completion failures, so
 * a failed stream never leaks an un-normalized error to either consumer.
 */
function normalizeStreamError(
  error: unknown,
  routing: ExecutorStreamHandle<unknown>["routing"],
): Error {
  if (isPolicyTerminal(error)) return error;
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
