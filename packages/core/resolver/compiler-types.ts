/**
 * Public and internal types for the prompt compiler boundary.
 *
 * The `resolver/compile.ts` boundary re-exports the public contracts from here.
 * Keeping the shapes in a small module lets the compiler entrypoint stay thin
 * while the resolution pass implementation imports the same contracts without
 * creating a runtime dependency cycle.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerationSettings } from '../types'
import type { InspectResult, ResolvedPrompt } from './types'
import type { ResolverPorts } from './ports'

/**
 * Options accepted by compiled prompt resolution and inspection.
 *
 * These are the call-site inputs for one compiler pass. Generation settings
 * extend this object so adapter callers can resolve exactly the prompt payload
 * they are about to send to a provider.
 */
export interface ResolveCallOptions extends GenerationSettings {
  /** Input passed to prompt, context, contributor, memory, skill, and blackboard resolvers. */
  input?: Record<string, unknown>
  /** Provider identifier used to select prompt adaptation blocks. */
  provider?: string
  /** Model identifier used for model-prefix adaptation and inspect metadata. */
  modelId?: string
  /** Maximum token budget for the composed system message. */
  tokenBudget?: number
}

/**
 * The result of one prompt-resolution pass.
 *
 * `PromptResolution` is the compiler boundary's call result: `args` contains
 * the SDK-agnostic prompt payload for adapters, while `inspect()` exposes the
 * inspection view produced by the same pass without resolving the prompt again.
 */
export interface PromptResolution {
  /** SDK-agnostic generation args - what adapters ship to the provider. */
  readonly args: ResolvedPrompt
  /** Structured inspection view derived from this pass without re-running resolution. */
  inspect(): InspectResult
}

/** @deprecated Use {@link PromptResolution}. */
export type Resolution = PromptResolution

/** A prompt config compiled once: schema merge, validation, and ports binding. */
export interface CompiledPrompt {
  /** Merged input schema (own + context contributions), or undefined when no fields exist. */
  readonly inputSchema: z.ZodType | undefined
  /** Hot path: one full pipeline pass with normal observability emission. */
  resolve(opts?: ResolveCallOptions): Promise<PromptResolution>
  /** Debug path: one quiet pipeline pass with today's inspect semantics. */
  inspect(opts?: ResolveCallOptions): Promise<InspectResult>
}

/** Options for compiling a prompt config into a reusable compiler boundary. */
export interface CompilePromptOptions {
  /**
   * Resolver ports used by the compiled prompt.
   *
   * Omitted ports fall back to the default runtime-backed ports. Tests can pass
   * fakes here to avoid global runtime, observability, cache, clock, or skill
   * registry state.
   */
  readonly ports?: Partial<ResolverPorts>
}

/** Whether a pass emits normal resolve artifacts or quiet inspect output. */
export type ResolutionEmissionMode = 'resolve' | 'inspect'

/** Internal full pass result before it is wrapped as {@link PromptResolution}. */
export interface PromptResolutionPass {
  readonly args: ResolvedPrompt
  readonly inspection: InspectResult
}
