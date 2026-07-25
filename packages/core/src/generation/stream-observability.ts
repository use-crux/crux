/** Descriptor-safe observability wrappers for managed stream handles. */

import { observe, observedErrorSummary } from "../observability";
import type { GenerationPerformanceTracker } from "./performance-metrics";
import { generationUsageAttributes } from "./result-meta";
import {
  createStreamSpanFinalizer,
  type StreamSpanFinalizer,
} from "./stream-finalizer";
import { createStreamTokenCoalescer } from "./stream-token-coalescer";
import { TimeoutError, normalizeBudgetMs } from "./timeout";

type ObservedStreamSpan = ReturnType<typeof observe.openSpan>;

const streamObservationSpans = new WeakMap<object, ObservedStreamSpan>();

/**
 * Continue finalized adapter work in the owning `generation.stream` context.
 *
 * Stream completion may arrive after raw iteration has closed the parent span.
 * This continuation preserves parent assignment without reopening or extending
 * that span. Unobserved values run normally and never manufacture a Run.
 *
 * @internal
 */
export function runInStreamObservationContext<T>(
  result: object,
  work: () => T | Promise<T>,
): T | Promise<T> {
  return streamObservationSpans.get(result)?.withContext(work) ?? work();
}

/** Add stream lifecycle observation without mutating the provider handle. */
export function attachStreamObservability<TResult>(
  result: TResult,
  span: ReturnType<typeof observe.openSpan>,
  performance: GenerationPerformanceTracker,
  chunkMs?: number,
  discardableAttempt = false,
): TResult {
  if (!result || typeof result !== "object") {
    span.end({
      attributes: { streamCompleted: true, streamObservable: false },
      metrics: performance.metrics(),
    });
    return result;
  }
  const record = result as Record<string, unknown>;
  const rawStream = record.rawStream;
  const extractTextDelta = record.extractTextDelta;
  const observesRawStream =
    isAsyncIterable(rawStream) && typeof extractTextDelta === "function";
  const completion = record.completion;
  const observesCompletion = typeof completion === "function";
  const finalizer = createStreamSpanFinalizer({
    span,
    performance,
    expectsStream: observesRawStream,
    expectsCompletion: observesCompletion,
  });

  if (!observesRawStream && !observesCompletion) {
    span.end({
      attributes: { streamCompleted: true, completionAvailable: false },
      metrics: performance.metrics(),
    });
    streamObservationSpans.set(result, span);
    return result;
  }

  const replacements = new Map<PropertyKey, unknown>();
  if (observesRawStream) {
    replacements.set(
      "rawStream",
      observedStream(
        rawStream,
        extractTextDelta as (chunk: unknown) => string | undefined,
        span,
        finalizer,
        performance,
        chunkMs,
        discardableAttempt,
      ),
    );
  }
  if (observesCompletion) {
    replacements.set(
      "completion",
      observedCompletion(result, completion, span, finalizer),
    );
  }
  const observed = cloneWithReplacements(result, replacements);
  streamObservationSpans.set(observed, span);
  return observed;
}

function observedCompletion(
  receiver: object,
  completion: Function,
  span: ReturnType<typeof observe.openSpan>,
  finalizer: StreamSpanFinalizer,
): (...args: unknown[]) => Promise<unknown> {
  let completionAttached = false;
  return async (...args: unknown[]) => {
    try {
      const meta = await span.withContext(() =>
        Reflect.apply(completion, receiver, args),
      );
      if (!completionAttached) {
        completionAttached = true;
        await span.withContext(() => {
          if (meta && typeof meta === "object") {
            const metaRecord = meta as Record<string, unknown>;
            const usageAttributes = generationUsageAttributes(metaRecord);
            if (usageAttributes) {
              observe.event({
                name: "usage.observed",
                attributes: usageAttributes,
              });
            }
            const artifactId = observe.artifact({
              kind: "stream.timeline",
              contentType: "application/json",
              encoding: "json",
              preview: metaRecord,
            });
            if (artifactId) {
              observe.edge({
                edgeType: "produced",
                from: { kind: "span", id: span.spanId },
                to: { kind: "artifact", id: artifactId },
              });
            }
          }
        });
      }
      finalizer.completionSettled({
        meta:
          meta && typeof meta === "object"
            ? (meta as Record<string, unknown>)
            : undefined,
      });
      return meta;
    } catch (error) {
      if (!completionAttached) {
        completionAttached = true;
        span.withContext(() => {
          observe.event({
            name: "completion.error",
            attributes: { ...observedErrorSummary(error) },
          });
        });
      }
      finalizer.completionErrored(error);
      throw error;
    }
  };
}

async function* observedStream(
  rawStream: AsyncIterable<unknown>,
  extractTextDelta: (chunk: unknown) => string | undefined,
  span: ReturnType<typeof observe.openSpan>,
  finalizer: StreamSpanFinalizer,
  performance: GenerationPerformanceTracker,
  chunkMs?: number,
  discardableAttempt = false,
): AsyncIterable<unknown> {
  let completed = false;
  let failed = false;
  const normalizedChunkMs = normalizeBudgetMs(chunkMs);
  const tokenChunks = createStreamTokenCoalescer({
    omitText: discardableAttempt,
    emit: (attributes) => {
      void span.withContext(() => {
        observe.event({ name: "token.chunk", attributes });
      });
    },
  });
  // Hoisted so the `finally` can close it: this is a manual iterator loop, so unlike
  // `for await` nothing closes the provider stream automatically when this generator
  // is returned early (a discarded attempt, or a consumer that stopped reading).
  let iterator: AsyncIterator<unknown> | undefined;
  try {
    const source = rawStream[Symbol.asyncIterator]();
    iterator = source;
    while (true) {
      const next = await span.withContext(() =>
        nextStreamChunk(source, normalizedChunkMs),
      );
      if (next.done) break;
      const chunk = next.value;
      const delta = extractTextDelta(chunk);
      if (delta) {
        performance.recordOutputChunk();
        tokenChunks.add(delta);
      }
      yield chunk;
    }
    completed = true;
    tokenChunks.flush();
    finalizer.streamEnded({ tokenChunkCount: tokenChunks.chunkCount() });
  } catch (error) {
    failed = true;
    tokenChunks.flush();
    finalizer.streamErrored({
      tokenChunkCount: tokenChunks.chunkCount(),
      error,
    });
    throw error;
  } finally {
    if (!completed && !failed) {
      tokenChunks.flush();
      finalizer.streamReturned({ tokenChunkCount: tokenChunks.chunkCount() });
      // Cascade cancellation to the provider so an abandoned stream does not stay
      // live and billable. Fail-open: cleanup must not mask the original outcome.
      try {
        await iterator?.return?.(undefined);
      } catch {
        // ignored
      }
    }
  }
}

async function nextStreamChunk(
  iterator: AsyncIterator<unknown>,
  chunkMs: number | undefined,
): Promise<IteratorResult<unknown>> {
  if (chunkMs === undefined) return iterator.next();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError({ budget: "chunk", limitMs: chunkMs })),
          chunkMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function cloneWithReplacements<TResult>(
  source: TResult,
  replacements: ReadonlyMap<PropertyKey, unknown>,
): TResult {
  const sourceObject = source as object;
  const clone = Object.create(Object.getPrototypeOf(sourceObject)) as object;
  for (const key of Reflect.ownKeys(sourceObject)) {
    const descriptor = Object.getOwnPropertyDescriptor(sourceObject, key);
    if (!descriptor) continue;
    Object.defineProperty(
      clone,
      key,
      replacements.has(key)
        ? replacementDescriptor(descriptor, replacements.get(key))
        : descriptor,
    );
  }
  for (const [key, value] of replacements) {
    if (Object.prototype.hasOwnProperty.call(sourceObject, key)) continue;
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }
  if (!Object.isExtensible(sourceObject)) Object.preventExtensions(clone);
  return clone as TResult;
}

function replacementDescriptor(
  source: PropertyDescriptor,
  value: unknown,
): PropertyDescriptor {
  return {
    configurable: source.configurable,
    enumerable: source.enumerable,
    writable: "writable" in source ? source.writable : false,
    value,
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value && typeof value === "object" && Symbol.asyncIterator in value,
  );
}
