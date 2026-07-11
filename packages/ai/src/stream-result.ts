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
  ExecutorStreamMeta,
  StreamResult,
} from "@use-crux/core/adapter";
import { createResultAccumulator } from "@use-crux/core/adapter";
import {
  attachRoutingToError,
  markRoutingMidStreamFailure,
} from "@use-crux/core/routing";

interface AiTextStreamLike {
  readonly textStream?: AsyncIterable<string>;
}

/** Build a canonical Crux stream result from an AI SDK executor handle. */
export function createAiStreamResult<TRawStream>(
  handle: ExecutorStreamHandle<TRawStream>,
): StreamResult<TRawStream> {
  let resolveStream: (() => void) | undefined;
  let rejectStream: ((error: unknown) => void) | undefined;
  const streamFinished = new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });
  void streamFinished.catch(() => undefined);
  const textStream = trackTextStream(readTextStream(handle.raw), {
    routing: handle.routing,
    resolveStream: () => resolveStream?.(),
    rejectStream: (error) => rejectStream?.(error),
  });

  return {
    textStream,
    raw: handle.raw,
    completion: (async () => {
      if (handle.routing !== undefined) {
        await streamFinished;
      }
      const meta = await handle.completion();
      return completionFromMeta(meta, handle.routing);
    })(),
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
    const routedError = attachStreamRouting(error, options.routing);
    options.rejectStream(routedError);
    throw routedError;
  }
}

function attachStreamRouting(
  error: unknown,
  routing: ExecutorStreamHandle<unknown>["routing"],
): unknown {
  if (routing === undefined) return error;
  const routed = markRoutingMidStreamFailure(routing);
  if (error instanceof Error) {
    return attachRoutingToError(error, routed);
  }
  return attachRoutingToError(new Error(String(error)), routed);
}

function completionFromMeta(
  meta: ExecutorStreamMeta | undefined,
  routing: ExecutorStreamHandle<unknown>["routing"],
) {
  const accumulator = createResultAccumulator();
  const text = meta?.text ?? "";
  accumulator.addStep({
    content: meta?.content ?? [{ type: "text", text }],
    ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
    finishReason: meta?.finishReason,
    responseId: meta?.responseId,
    modelId: meta?.actualModelId,
    ...(meta?.warnings !== undefined ? { warnings: meta.warnings } : {}),
    ...(meta?.providerMetadata !== undefined
      ? { providerMetadata: meta.providerMetadata }
      : {}),
  });
  return accumulator.finalizeCompletion({
    messages: meta?.messages ? [...meta.messages] : [],
    ...(meta?.cost !== undefined ? { cost: meta.cost } : {}),
    ...(routing !== undefined ? { routing } : {}),
  });
}
