/**
 * First-token stream gate for routed stream attempts.
 *
 * The resolver must know whether token one arrived before returning a stream
 * handle to the caller. This helper pulls one chunk, buffers it back into the
 * public stream, and aborts the current provider attempt if the first-token
 * deadline wins the race.
 *
 * @module
 * @internal
 */

import { TimeoutError, normalizeBudgetMs } from "../generation/timeout";

/** Options for enforcing the first-token deadline on one stream attempt. */
export interface FirstTokenGateOptions {
  /** Configured first-token budget in milliseconds. Disabled when absent. */
  readonly firstTokenMs?: number;
  /** Abort controller tied to the current provider attempt. */
  readonly attemptController: AbortController | undefined;
}

/** Enforce first-token timeout for known stream handle shapes. */
export async function gateFirstToken<R>(
  result: R,
  options: FirstTokenGateOptions,
): Promise<R> {
  const limitMs = normalizeBudgetMs(options.firstTokenMs);
  if (limitMs === undefined) return result;

  if (isNativeStreamHandle(result)) {
    return gateNativeStreamHandle(result, limitMs, options.attemptController) as R;
  }
  if (isExecutorStreamHandle(result)) {
    return gateExecutorStreamHandle(
      result,
      limitMs,
      options.attemptController,
    ) as R;
  }

  return result;
}

interface NativeStreamHandleLike {
  readonly raw?: unknown;
  readonly rawStream: AsyncIterable<unknown>;
  readonly extractTextDelta: (chunk: unknown) => string | undefined;
  readonly completion: () => Promise<unknown>;
}

interface ExecutorStreamHandleLike {
  readonly raw: {
    readonly textStream?: AsyncIterable<string>;
  };
  readonly completion: () => Promise<unknown>;
}

function isNativeStreamHandle(value: unknown): value is NativeStreamHandleLike {
  return (
    isRecord(value) &&
    isAsyncIterable(value.rawStream) &&
    typeof value.extractTextDelta === "function" &&
    typeof value.completion === "function"
  );
}

function isExecutorStreamHandle(value: unknown): value is ExecutorStreamHandleLike {
  return (
    isRecord(value) &&
    isRecord(value.raw) &&
    isAsyncIterable(value.raw.textStream) &&
    typeof value.completion === "function"
  );
}

async function gateNativeStreamHandle(
  handle: NativeStreamHandleLike,
  limitMs: number,
  attemptController: AbortController | undefined,
): Promise<NativeStreamHandleLike> {
  const iterator = handle.rawStream[Symbol.asyncIterator]();
  const first = await readFirstChunk(iterator, limitMs, attemptController);
  if (first.done) return handle;

  return {
    ...handle,
    rawStream: prependFirstChunk(first.value, iterator),
  };
}

async function gateExecutorStreamHandle(
  handle: ExecutorStreamHandleLike,
  limitMs: number,
  attemptController: AbortController | undefined,
): Promise<ExecutorStreamHandleLike> {
  const textStream = handle.raw.textStream;
  if (textStream === undefined) return handle;

  const iterator = textStream[Symbol.asyncIterator]();
  const first = await readFirstChunk(iterator, limitMs, attemptController);
  if (first.done) return handle;

  return {
    ...handle,
    raw: {
      ...handle.raw,
      textStream: prependFirstChunk(first.value, iterator),
    },
  };
}

async function readFirstChunk<T>(
  iterator: AsyncIterator<T>,
  limitMs: number,
  attemptController: AbortController | undefined,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new TimeoutError({
          budget: "firstToken",
          limitMs,
        });
        attemptController?.abort(error);
        reject(error);
      }, limitMs);
    });
    return await Promise.race([iterator.next(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function* prependFirstChunk<T>(
  first: T,
  iterator: AsyncIterator<T>,
): AsyncIterable<T> {
  yield first;
  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    isRecord(value) &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
