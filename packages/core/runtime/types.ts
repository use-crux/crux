/**
 * Runtime middleware contracts owned by the `runtime/` domain.
 *
 * {@link PromptMiddleware} wraps every adapter `generate()`/`stream()` call. It
 * is installed on the runtime via `config({ generation: { middleware } })` or
 * `updateRuntime({ middleware })`, and composed with layered chaining by
 * `mergeRuntime()`. The argument/return shapes here describe the data that
 * devtools, caches, and cost trackers read as a call flows back through the
 * middleware stack.
 *
 * @module
 */

import type { AnyPromptConfig } from '../prompt/prompt-types'
import type { ResolvedPrompt } from '../resolver/types'
import type { TraceMeta } from '../generation/types'

// ─────────────────────────────────────────────────────────────────
// Runtime Middleware
// ─────────────────────────────────────────────────────────────────

/**
 * Arguments passed to a {@link PromptMiddleware} on the way down the stack.
 *
 * @example
 * ```ts
 * updateRuntime({
 *   middleware: async (args, next) => {
 *     const start = Date.now()
 *     const result = await next(args)
 *     console.log(`${args.promptId} took ${Date.now() - start}ms`)
 *     return result
 *   },
 * })
 * ```
 */
export interface PromptMiddlewareArgs {
  promptId: string | undefined
  preparedArgs: Record<string, unknown>
  operation?: 'generate' | 'stream'
  promptConfig?: AnyPromptConfig
  input?: Record<string, unknown>
  provider?: string
  model?: unknown
  resolved?: ResolvedPrompt
  outputMode?: 'text' | 'object'
  createCachedStreamResult?: (cached: {
    text?: string
    object?: unknown
    meta?: Record<string, unknown>
  }) => MiddlewareResult
}

/**
 * Heterogeneous middleware return value.
 *
 * Adapters return adapter-shaped objects (text + `_meta`, possibly `object` for
 * structured output). Middleware composes around these without knowing the
 * concrete shape, so the structural contract here covers the fields that
 * devtools/cache/etc. read on the way back.
 */
export interface MiddlewareResult {
  text?: string
  object?: unknown
  _meta?: TraceMeta & {
    streaming?: { ttftMs?: number; tokensPerSecond?: number; totalChunks?: number }
    fallback?: { attempts: number; failedModels: string[]; details: unknown[] }
    traceId?: string
    _streamCompletion?: Promise<MiddlewareResult>
    semanticCache?: Record<string, unknown>
  }
  [key: string]: unknown
}

/**
 * Global middleware function that wraps every adapter `generate()` call.
 *
 * Each layer receives {@link PromptMiddlewareArgs} and a `next` continuation;
 * returning the awaited `next(args)` (optionally transformed) chains to the
 * underlying adapter call.
 */
export type PromptMiddleware = (
  args: PromptMiddlewareArgs,
  next: (args: PromptMiddlewareArgs) => Promise<MiddlewareResult>,
) => Promise<MiddlewareResult>
