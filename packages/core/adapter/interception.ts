/**
 * Generation interception — the seam deterministic replay (quality
 * cassettes) hooks into at the executor boundary.
 *
 * `executorAdapter()` routes every `runLoop`/`attemptStructured` spec call
 * through {@link interceptGeneration}. With no interceptor installed the
 * call executes directly — zero overhead, zero behavior change. An installed
 * interceptor receives a normalized, serializable description of the call
 * plus the live `execute` continuation, and decides per call: pass through,
 * record, or short-circuit with a previously recorded result.
 *
 * The slot is process-global and single-consumer by design: the quality
 * engine installs ONE dispatcher that scopes per-run state internally (via
 * AsyncLocalStorage), so concurrent evaluation runs partition without
 * fighting over this slot. Streaming calls (`runStream`) are not
 * intercepted — replay consumers fail closed or pass through at a higher
 * level.
 *
 * @module
 */

import type { ModelInfo } from '../types'
import type { Message } from '../generation/messages'

/**
 * A normalized, serializable description of one model call at the executor
 * boundary. Volatile per-call artifacts (abort signals, observers, raw SDK
 * objects) are excluded by construction — what remains is exactly the
 * identity a replay match key may hash.
 */
export interface InterceptedGeneration {
  /** Which executor method the call targets. */
  readonly kind: 'loop' | 'structured'
  /** The resolved prompt's id, when the call originated from a prompt. */
  readonly promptId: string | undefined
  /** Provider/model identity from `describeModel()`. */
  readonly modelInfo: ModelInfo
  /** Assembled system prompt text in effect for this call. */
  readonly system: string | undefined
  /** Single-shot user prompt, when set (mutually exclusive with `messages`). */
  readonly prompt: string | undefined
  /** Conversation history for this call (includes retry corrective rounds). */
  readonly messages: readonly Message[] | undefined
  /** Provider-native settings after `mapSettings()`. */
  readonly settings: Record<string, unknown>
  /** Sorted names + descriptions of the tools offered to the model. */
  readonly tools: ReadonlyArray<{ name: string; description?: string }> | undefined
}

/**
 * The interceptor contract: receive the normalized call and the live
 * continuation, return the outcome the executor should use. The result is
 * the spec method's return type — a replayed result must be shaped like the
 * live one (minus raw SDK objects, which replay cannot reproduce).
 */
export type GenerationInterceptor = (
  call: InterceptedGeneration,
  execute: () => Promise<unknown>,
) => Promise<unknown>

let current: GenerationInterceptor | undefined

/** Install the process-wide generation interceptor (single consumer). @internal */
export function setGenerationInterceptor(interceptor: GenerationInterceptor): void {
  current = interceptor
}

/** Remove the process-wide generation interceptor. @internal */
export function clearGenerationInterceptor(): void {
  current = undefined
}

/**
 * Route one executor call through the installed interceptor, or execute it
 * directly when none is installed. The cast is the replay boundary: an
 * interceptor that short-circuits must return the spec method's result
 * shape.
 *
 * @internal
 */
export async function interceptGeneration<T>(call: InterceptedGeneration, execute: () => Promise<T>): Promise<T> {
  if (current === undefined) return execute()
  return (await current(call, execute)) as T
}

/** Project a tool map to its serializable identity surface. @internal */
export function describeTools(
  tools: Record<string, unknown> | undefined,
): ReadonlyArray<{ name: string; description?: string }> | undefined {
  if (tools === undefined) return undefined
  return Object.keys(tools)
    .sort()
    .map((name) => {
      const tool = tools[name]
      const description =
        tool !== null && typeof tool === 'object' && typeof (tool as { description?: unknown }).description === 'string'
          ? ((tool as { description: string }).description satisfies string)
          : undefined
      return { name, ...(description !== undefined ? { description } : {}) }
    })
}
