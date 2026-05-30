/**
 * Shared orchestration utilities for adapter packages.
 *
 * Extracts the cross-cutting concerns that are identical across all adapters:
 * fallback loops, middleware wrapping, hook dispatch,
 * and stream progress interception.
 *
 * Each adapter composes these functions, keeping only SDK-specific code
 * (message conversion, settings mapping, API calls) local.
 *
 * @module
 * @internal
 */

import type { FallbackModel, FallbackMeta, FallbackAttemptDetail } from './fallback'
import { classifyError, shouldAttemptFallback } from './fallback'
import type { PromptMiddleware, MiddlewareResult, AnyPromptConfig, ResolvedPrompt } from './types'
import type { StreamProgressReporter } from './middleware'
import { getRuntime } from './runtime'
import { warnMissingSemanticCachePlugin } from './cache'
import { observe } from './observability'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Context for generate/stream orchestration. Adapters construct this
 * from their prompt + options and pass it to `orchestrateGenerate()`
 * or `orchestrateStream()`.
 */
export interface OrchestrationSpec<TPreparedArgs extends Record<string, unknown> = Record<string, unknown>> {
  /** The prompt ID (used for middleware args and hook args). */
  promptId: string | undefined
  /**
   * The prompt's config and hooks.
   *
   * Accepts the full `AnyPromptConfig` from any concrete prompt — the
   * orchestrator only reads `hooks`, and adapter generic
   * `TOutput` is erased by this boundary.
   */
  promptConfig: AnyPromptConfig
  /** SDK-specific prepared args (model, messages, settings, etc.). */
  preparedArgs: TPreparedArgs
  /** The model being used. */
  model: unknown
  /** The input passed to generate(). */
  input: Record<string, unknown>
  /** Operation being orchestrated. Defaults to generate. */
  operation?: 'generate' | 'stream'
  /** Resolved prompt data, when available. */
  resolved?: ResolvedPrompt
  /** Provider identifier, when known. */
  provider?: string
  /** Output mode for cache hydration. */
  outputMode?: 'text' | 'object'
  /** Optional factory for cached stream replay. */
  createCachedStreamResult?: (cached: {
    text?: string
    object?: unknown
    meta?: Record<string, unknown>
  }) => MiddlewareResult
  /**
   * Maximum wall-clock runtime for this operation, when the adapter supports
   * one. This is observability metadata only; adapters still own enforcement.
   */
  timeoutMs?: number
}

/**
 * Callback that extracts a text delta string from an SDK-specific stream chunk.
 * Each adapter provides its own extractor since chunk formats differ by SDK.
 *
 * @example
 * ```ts
 * // OpenAI
 * const extract: TextDeltaExtractor = (chunk) =>
 *   chunk?.choices?.[0]?.delta?.content
 *
 * // Anthropic
 * const extract: TextDeltaExtractor = (chunk) =>
 *   chunk?.type === 'content_block_delta' ? chunk.delta?.text : undefined
 * ```
 */
export type TextDeltaExtractor = (chunk: unknown) => string | undefined

/** Metadata attached to generate/stream results by adapters. */
interface ResultMeta {
  _meta?: {
    cost?: number
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    fallback?: FallbackMeta
    [key: string]: unknown
  }
}

/** Extract _meta from a result if it has the convention field. */
function getMeta(result: unknown): ResultMeta['_meta'] | undefined {
  if (result && typeof result === 'object' && '_meta' in result) {
    return (result as ResultMeta)._meta
  }
  return undefined
}

/** Attach or merge _meta on a result. */
function setMeta(result: unknown, meta: Partial<NonNullable<ResultMeta['_meta']>>): void {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    const existing = (r._meta ?? {}) as Record<string, unknown>
    r._meta = { ...existing, ...meta }
  }
}

// ─────────────────────────────────────────────────────────────────
// withAttemptTimeout
// ─────────────────────────────────────────────────────────────────

/**
 * Wrap an async function call with a per-attempt timeout using AbortController.
 * If no timeout is set, runs the function directly with zero overhead.
 *
 * @param fn - The async function to execute
 * @param timeoutMs - Optional timeout in milliseconds. When exceeded, throws
 *   a `DOMException` with name `'AbortError'`.
 * @returns The result of `fn`
 *
 * @example
 * ```ts
 * const result = await withAttemptTimeout(
 *   () => client.chat.completions.create(args),
 *   10_000, // 10s timeout
 * )
 * ```
 */
export async function withAttemptTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return fn()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new DOMException('Fallback attempt timed out', 'AbortError'))
        })
      }),
    ])
    return result
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────
// executeFallbackLoop
// ─────────────────────────────────────────────────────────────────

/**
 * Generic fallback loop for adapter packages. Tries each model in order,
 * tracking per-attempt timing, error classification, and cost. Attaches
 * `_meta.fallback` metadata on the successful result when prior attempts failed.
 *
 * @param fb - A `FallbackModel` wrapper created by `fallback(modelA, modelB, ...)`
 * @param tryModel - Adapter-specific callback that executes a single model attempt.
 *   Receives the model and returns the SDK result with `_meta` attached.
 * @param extractModelId - Extracts a human-readable model identifier from the
 *   adapter's model type (e.g., `(m) => m` for string models, `(m) => m.modelId` for AI SDK)
 * @returns The result from the first successful model, with `_meta.fallback`
 *   populated when fallback occurred
 * @throws {AggregateError} When all models fail
 *
 * @example
 * ```ts
 * // Inside an adapter's generate():
 * if (isFallback(opts.model)) {
 *   return executeFallbackLoop(
 *     opts.model,
 *     (model) => this.generate(prompt, { ...opts, model }),
 *     (model) => model, // string model IDs
 *   )
 * }
 * ```
 */
export async function executeFallbackLoop<M, R>(
  fb: FallbackModel<M>,
  tryModel: (model: M) => Promise<R>,
  extractModelId: (model: M) => string,
): Promise<R> {
  const { models, options: fallbackOpts } = fb
  const errors: Error[] = []
  const details: FallbackAttemptDetail[] = []
  let previousFailedSpanId: ReturnType<typeof observe.openSpan>['spanId'] | undefined
  let previousFailedModelId: string | undefined

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    const modelId = extractModelId(model)
    const attemptStart = Date.now()
    const attemptSpan = observe.openSpan({
      name: 'fallback.attempt',
      family: 'routing',
      primitive: 'fallback.attempt',
      attributes: {
        attempt: i + 1,
        model: modelId,
        totalModels: models.length,
        hasTimeout: fallbackOpts.timeout !== undefined,
      },
    })

    try {
      const result = await attemptSpan.withContext(() =>
        withAttemptTimeout(() => tryModel(model), fallbackOpts.timeout),
      )
      const durationMs = Date.now() - attemptStart

      details.push({
        model: modelId,
        durationMs,
        status: 'success',
        cost: getMeta(result)?.cost,
      })

      // Only attach fallback meta if there were failed attempts
      if (errors.length > 0) {
        setMeta(result, {
          fallback: {
            attempts: i + 1,
            failedModels: details.filter((d) => d.status === 'error').map((d) => d.model),
            details,
          } satisfies FallbackMeta,
        })
      }

      if (previousFailedSpanId && previousFailedModelId) {
        observe.edge({
          edgeType: 'fallback.attempt',
          from: { kind: 'span', id: previousFailedSpanId },
          to: { kind: 'span', id: attemptSpan.spanId },
          attributes: {
            fromModel: previousFailedModelId,
            toModel: modelId,
            attempt: i + 1,
          },
        })
      }
      attemptSpan.end({
        attempt: i + 1,
        model: modelId,
        totalModels: models.length,
        attemptStatus: 'success',
        durationMs,
        cost: getMeta(result)?.cost,
        fallbackOccurred: errors.length > 0,
      })
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const durationMs = Date.now() - attemptStart
      const errorCategory = classifyError(err)
      const willAttemptFallback = shouldAttemptFallback(err, fallbackOpts)

      details.push({
        model: modelId,
        durationMs,
        status: 'error',
        error: err.message,
        errorCategory,
      })

      // Check if this error should trigger fallback
      if (!willAttemptFallback) {
        attemptSpan.error(err, {
          attempt: i + 1,
          model: modelId,
          totalModels: models.length,
          attemptStatus: 'error',
          errorCategory,
          willAttemptFallback: false,
          durationMs,
        })
        throw err
      }

      errors.push(err)
      attemptSpan.error(err, {
        attempt: i + 1,
        model: modelId,
        totalModels: models.length,
        attemptStatus: 'error',
        errorCategory,
        willAttemptFallback: i < models.length - 1,
        durationMs,
      })
      previousFailedSpanId = attemptSpan.spanId
      previousFailedModelId = modelId
      fallbackOpts.onAttemptError?.(err, i + 1, model)
    }
  }

  throw new AggregateError(errors, `All ${models.length} fallback models failed`)
}

// ─────────────────────────────────────────────────────────────────
// orchestrateGenerate
// ─────────────────────────────────────────────────────────────────

/**
 * Shared generate orchestration. Wraps an adapter's SDK-specific `doGenerate`
 * with middleware, timing, and hooks (`onGenerate`/`onError`) — the
 * cross-cutting concerns that are identical across all adapters.
 *
 * @param spec - Orchestration context: prompt metadata, prepared SDK args,
 *   model reference, and input data.
 * @param doGenerate - Adapter-specific generation function. Receives
 *   `preparedArgs` (possibly modified by middleware) and returns the SDK result.
 * @returns The SDK result after hooks have fired.
 *
 * @example
 * ```ts
 * return orchestrateGenerate(
 *   {
 *     promptId: prompt.id,
 *     promptConfig: prompt.config,
 *     preparedArgs: { model: opts.model, messages, settings },
 *     model: opts.model,
 *     input: opts.input ?? {},
 *   },
 *   doGenerate,
 * )
 * ```
 */
export async function orchestrateGenerate<TArgs extends Record<string, unknown>, TResult>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  return observe.span(
    {
      name: spec.promptId ? `generate ${spec.promptId}` : 'generate',
      family: 'generation',
      primitive: 'generation.call',
      attributes: generationAttributes(spec, 'generate'),
    },
    async () => {
      emitOperationDeadline(spec.timeoutMs)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)

      const result = await withAttemptTimeout(() => orchestrateGenerateInner(spec, doGenerate), spec.timeoutMs)
      const meta = getMeta(result)
      if (meta?.usage) {
        observe.event({
          name: 'usage.observed',
          attributes: {
            inputTokens: meta.usage.inputTokens,
            outputTokens: meta.usage.outputTokens,
            totalTokens: meta.usage.totalTokens,
            ...(typeof meta.cost === 'number' ? { cost: meta.cost } : {}),
          },
        })
      }

      const outputArtifactId = observe.artifact({
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationOutputPreview(result),
      })
      linkActiveSpanToArtifact('produced', outputArtifactId)
      return result
    },
  )
}

async function orchestrateGenerateInner<TArgs extends Record<string, unknown>, TResult>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const middleware = getRuntime().middleware
  const start = Date.now()
  maybeWarnMissingSemanticCache(spec)

  try {
    let result: TResult
    if (middleware) {
      result = (await middleware(
        {
          promptId: spec.promptId,
          preparedArgs: spec.preparedArgs,
          operation: 'generate',
          promptConfig: spec.promptConfig as AnyPromptConfig,
          input: spec.input,
          provider: spec.provider,
          model: spec.model,
          resolved: spec.resolved,
          outputMode: spec.outputMode,
        },
        async (mArgs) => (await doGenerate(mArgs.preparedArgs as TArgs)) as unknown as MiddlewareResult,
      )) as unknown as TResult
    } else {
      result = await doGenerate(spec.preparedArgs)
    }

    const durationMs = Date.now() - start

    // Fire onGenerate hook — `TResult` is erased at this boundary; the typed
    // hook signature on `AnyPromptConfig` lives in user-defined prompts.
    if (spec.promptConfig.hooks?.onGenerate) {
      spec.promptConfig.hooks.onGenerate(
        { promptId: spec.promptId, durationMs },
        result as unknown as Parameters<NonNullable<typeof spec.promptConfig.hooks.onGenerate>>[1],
      )
    }

    return result
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────
// orchestrateStream
// ─────────────────────────────────────────────────────────────────

/**
 * Shared stream orchestration. Wraps an adapter's SDK-specific `doStream`
 * with middleware and error hook dispatch.
 *
 * @remarks
 * Unlike `orchestrateGenerate`, this does NOT fire `onGenerate`. Stream
 * orchestration handles middleware wrapping and `onError` hook dispatch.
 *
 * @param spec - Orchestration context (subset of generate spec)
 * @param doStream - Adapter-specific streaming function
 * @returns The SDK stream result
 */
export async function orchestrateStream<TArgs extends Record<string, unknown>, TResult>(
  spec: Pick<
    OrchestrationSpec<TArgs>,
    | 'promptId'
    | 'promptConfig'
    | 'preparedArgs'
    | 'input'
    | 'provider'
    | 'model'
    | 'resolved'
    | 'outputMode'
    | 'createCachedStreamResult'
    | 'timeoutMs'
  >,
  doStream: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const span = observe.openSpan({
    name: spec.promptId ? `stream ${spec.promptId}` : 'stream',
    family: 'generation',
    primitive: 'generation.stream',
    attributes: generationAttributes(spec, 'stream'),
  })
  try {
    return await span.withContext(async () => {
      emitOperationDeadline(spec.timeoutMs)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)
      const result = await withAttemptTimeout(() => orchestrateStreamInner(spec, doStream), spec.timeoutMs)
      attachStreamObservability(result, span)
      return result
    })
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function orchestrateStreamInner<TArgs extends Record<string, unknown>, TResult>(
  spec: Pick<
    OrchestrationSpec<TArgs>,
    | 'promptId'
    | 'promptConfig'
    | 'preparedArgs'
    | 'input'
    | 'provider'
    | 'model'
    | 'resolved'
    | 'outputMode'
    | 'createCachedStreamResult'
  >,
  doStream: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const middleware = getRuntime().middleware
  maybeWarnMissingSemanticCache(spec)

  try {
    if (middleware) {
      // Middleware is transparent — passes the result through from next()
      return (await middleware(
        {
          promptId: spec.promptId,
          preparedArgs: spec.preparedArgs,
          operation: 'stream',
          promptConfig: spec.promptConfig as AnyPromptConfig,
          input: spec.input,
          provider: spec.provider,
          model: spec.model,
          resolved: spec.resolved,
          outputMode: spec.outputMode,
          createCachedStreamResult: spec.createCachedStreamResult,
        },
        async (mArgs) => (await doStream(mArgs.preparedArgs as TArgs)) as unknown as MiddlewareResult,
      )) as unknown as TResult
    }
    return await doStream(spec.preparedArgs)
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    throw error
  }
}

function generationAttributes(
  spec: Pick<
    OrchestrationSpec<Record<string, unknown>>,
    'promptId' | 'provider' | 'model' | 'outputMode' | 'timeoutMs'
  >,
  operation: 'generate' | 'stream',
): Record<string, unknown> {
  const timeoutMs = normalizeTimeoutMs(spec.timeoutMs)
  return {
    operation,
    ...(spec.promptId ? { promptId: spec.promptId } : {}),
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(typeof spec.model === 'string' ? { model: spec.model } : {}),
    ...(spec.outputMode ? { outputMode: spec.outputMode } : {}),
    ...(timeoutMs ? { timeoutMs, deadlineAt: new Date(Date.now() + timeoutMs).toISOString() } : {}),
  }
}

function emitOperationDeadline(timeoutMs: number | undefined): void {
  const normalized = normalizeTimeoutMs(timeoutMs)
  if (!normalized) return
  observe.event({
    name: 'operation.deadline',
    attributes: {
      timeoutMs: normalized,
      deadlineAt: new Date(Date.now() + normalized).toISOString(),
    },
  })
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined
  return Math.floor(timeoutMs)
}

function generationInputPreview(
  spec: Pick<OrchestrationSpec<Record<string, unknown>>, 'preparedArgs' | 'input' | 'resolved'>,
): Record<string, unknown> {
  const prepared = spec.preparedArgs
  return {
    input: spec.input,
    messages: prepared.messages,
    system: prepared.system,
    systemBlocks: prepared.systemBlocks,
    prompt: spec.resolved?.prompt,
  }
}

function linkResolvedContextArtifacts(resolved: ResolvedPrompt | undefined): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const seen = new Set<string>()
  for (const block of resolved?.systemBlocks ?? []) {
    if (!block.artifactId || block.source === 'prompt' || seen.has(block.artifactId)) continue
    seen.add(block.artifactId)
    observe.edge({
      edgeType: 'consumed',
      from: { kind: 'artifact', id: block.artifactId },
      to: { kind: 'span', id: spanId },
      attributes: {
        source: block.source,
        contextSource: block.source,
      },
    })
  }
}

function generationOutputPreview(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { value: result }
  const record = result as Record<string, unknown>
  return {
    text: record.text,
    object: record.object,
    meta: record._meta,
  }
}

function linkActiveSpanToArtifact(
  edgeType: 'consumed' | 'produced',
  artifactId: ReturnType<typeof observe.artifact>,
): void {
  if (!artifactId) return
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  observe.edge({
    edgeType,
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
  })
}

function attachStreamObservability(result: unknown, span: ReturnType<typeof observe.openSpan>): void {
  if (!result || typeof result !== 'object') {
    span.end({ attributes: { streamCompleted: true, streamObservable: false } })
    return
  }
  const record = result as Record<string, unknown>
  const rawStream = record.rawStream
  const extractTextDelta = record.extractTextDelta
  const observesRawStream = isAsyncIterable(rawStream) && typeof extractTextDelta === 'function'
  if (observesRawStream) {
    record.rawStream = observedStream(rawStream, extractTextDelta as (chunk: unknown) => string | undefined, span)
  }

  const completion = record.completion
  if (typeof completion !== 'function') {
    if (!observesRawStream) {
      span.end({ attributes: { streamCompleted: true, completionAvailable: false } })
    }
    return
  }

  record.completion = async (...args: unknown[]) => {
    try {
      const meta = await span.withContext(() => (completion as (...inner: unknown[]) => Promise<unknown>)(...args))
      await span.withContext(() => {
        if (meta && typeof meta === 'object') {
          const metaRecord = meta as Record<string, unknown>
          const usage = metaRecord.usage
          if (usage && typeof usage === 'object') {
            observe.event({ name: 'usage.observed', attributes: usage as Record<string, unknown> })
          }
          const outputArtifactId = observe.artifact({
            kind: 'stream.timeline',
            contentType: 'application/json',
            encoding: 'json',
            preview: metaRecord,
          })
          linkActiveSpanToArtifact('produced', outputArtifactId)
        }
      })
      span.end()
      return meta
    } catch (error) {
      span.error(error)
      throw error
    }
  }
}

async function* observedStream(
  rawStream: AsyncIterable<unknown>,
  extractTextDelta: (chunk: unknown) => string | undefined,
  span: ReturnType<typeof observe.openSpan>,
): AsyncIterable<unknown> {
  let index = 0
  try {
    for await (const chunk of rawStream) {
      const delta = extractTextDelta(chunk)
      if (delta) {
        await span.withContext(() => {
          observe.event({
            name: 'token.delta',
            attributes: {
              index,
              text: delta,
              length: delta.length,
            },
          })
        })
        index += 1
      }
      yield chunk
    }
    span.end({ attributes: { streamCompleted: true, tokenDeltaCount: index } })
  } catch (error) {
    span.error(error)
    throw error
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value)
}

function maybeWarnMissingSemanticCache(
  spec: Pick<OrchestrationSpec<Record<string, unknown>>, 'promptId' | 'promptConfig'>,
): void {
  const semantic = (spec.promptConfig as { cache?: { semantic?: unknown } }).cache?.semantic
  if (semantic !== undefined && semantic !== false && !getRuntime().semanticCacheInstalled) {
    warnMissingSemanticCachePlugin(spec.promptId)
  }
}

// ─────────────────────────────────────────────────────────────────
// wrapStreamIterable
// ─────────────────────────────────────────────────────────────────

/**
 * Mutate `[Symbol.asyncIterator]` on an SDK stream object to intercept
 * chunks for progress reporting and completion tracking.
 *
 * @remarks
 * Mutates the original object (not a wrapper) so all SDK methods
 * (`.abort()`, `.controller`, `.toReadableStream()`, etc.) are preserved.
 * Used by native SDK adapters (OpenAI, Google, Anthropic). The AI SDK adapter
 * uses `onChunk`/`onFinish` callbacks instead and does not need this.
 *
 * @param stream - The raw SDK stream object (must have `[Symbol.asyncIterator]`)
 * @param progress - Optional progress reporter from devtools (provides `onChunk`, `flush`, `dispose`)
 * @param extractTextDelta - SDK-specific chunk to text delta extractor
 * @param onComplete - Called when the iterator finishes (receives final chunk if available)
 * @param onError - Called on iteration error (receives the error)
 */
export function wrapStreamIterable(
  stream: { [Symbol.asyncIterator]: () => AsyncIterator<unknown> },
  progress: StreamProgressReporter | undefined,
  extractTextDelta: TextDeltaExtractor,
  onComplete: (finalChunk?: unknown) => void,
  onError: (err: unknown) => void,
): void {
  const originalIterFn = stream[Symbol.asyncIterator].bind(stream)

  stream[Symbol.asyncIterator] = function () {
    const iter = originalIterFn()
    return {
      async next() {
        try {
          const result = await iter.next()
          if (!result.done) {
            const textDelta = extractTextDelta(result.value)
            progress?.onChunk(textDelta ?? undefined)
          } else {
            await progress?.flush()
            onComplete(undefined)
          }
          return result
        } catch (err) {
          progress?.dispose()
          onError(err)
          throw err
        }
      },
      return: iter.return?.bind(iter),
      throw: iter.throw?.bind(iter),
    }
  }
}
