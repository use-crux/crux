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

interface AiTextStreamLike {
  readonly textStream?: AsyncIterable<string>;
}

/** Build a canonical Crux stream result from an AI SDK executor handle. */
export function createAiStreamResult<TRawStream>(
  handle: ExecutorStreamHandle<TRawStream>,
): StreamResult<TRawStream> {
  const textStream = readTextStream(handle.raw);

  return {
    textStream,
    raw: handle.raw,
    completion: (async () => {
      const meta = await handle.completion();
      return completionFromMeta(meta);
    })(),
  };
}

function readTextStream(raw: unknown): AsyncIterable<string> {
  const stream = (raw as AiTextStreamLike | undefined)?.textStream;
  return stream ?? emptyTextStream();
}

async function* emptyTextStream(): AsyncIterable<string> {}

function completionFromMeta(meta: ExecutorStreamMeta | undefined) {
  const accumulator = createResultAccumulator();
  const text = meta?.text ?? "";
  accumulator.addStep({
    text,
    ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
    finishReason: meta?.finishReason,
    responseId: meta?.responseId,
    modelId: meta?.actualModelId,
  });
  return accumulator.finalizeCompletion({
    messages: [],
    ...(meta?.cost !== undefined ? { cost: meta.cost } : {}),
  });
}
