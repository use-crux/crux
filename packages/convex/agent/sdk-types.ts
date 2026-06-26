import { Agent as ConvexAgent } from '@convex-dev/agent'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ContextEntry, Prompt, ResolvedPrompt } from '@crux/core'
import type { CruxStore } from '@crux/core/store'
import type { z } from 'zod'
import type { ComponentApi } from '../src/component/_generated/component'
import type { ConvexRuntimeTarget } from '../runtime'
import type {
  ConvexAgentCallArgs,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentThreadTarget,
  CruxConvexThread,
  PromptInput,
} from './lifecycle-types'
import type { ConvexAgentContextMessage } from './driver'
import type { ConvexAgentComponent } from './facade'
import type { ToolRecord } from './sdk-tools'

type ConvexAgentConstructorOptions = ConstructorParameters<typeof ConvexAgent>[1]

/** Convex Agent constructor options forwarded without Crux interpretation. */
export type ConvexAgentPassthroughOptions = Omit<
  ConvexAgentConstructorOptions,
  'name' | 'languageModel' | 'instructions' | 'tools' | 'contextHandler' | 'stopWhen'
>

/** Options for `createAgent()`. */
export interface CreateAgentOptions {
  /** Override the generated Convex Agent name. */
  name?: string
  /** Model override used when the definition does not already carry one. */
  model?: unknown
  /** Prompt input used when resolving a Crux prompt definition. */
  input?: Record<string, unknown>
  /** Token budget forwarded to prompt resolution. */
  tokenBudget?: number
  /** Additional Convex Agent tools merged after tools inferred from the definition. */
  tools?: Record<string, unknown>
}

/**
 * Convex Agent model configuration accepted by Crux.
 *
 * Prefer `languageModel` for parity with Convex Agent. `model` remains
 * supported as the legacy Crux Convex alias.
 */
export type ConvexAgentModelConfig =
  | {
      languageModel: LanguageModelV3
      model?: LanguageModelV3
    }
  | {
      languageModel?: LanguageModelV3
      model: LanguageModelV3
    }

/** Public `convexAgent()` configuration before model binding. */
export interface ConvexAgentBaseConfig<
  TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>,
> extends ConvexAgentPassthroughOptions {
  /**
   * Convex components used by the agent boundary.
   *
   * - `crux` is the Crux persistence component, usually `components.crux`.
   * - `agent` is the Convex Agent component, usually `components.agent`.
   */
  components: {
    crux: ComponentApi
    agent: ConvexAgentComponent
  }
  /** Public agent name. Defaults to the prompt id. */
  name?: string
  /** Crux prompt resolved for each turn. */
  prompt: TPrompt
  /** Default token budget for prompt resolution. */
  tokenBudget?: number
  /** Extra tools added to every turn after prompt-resolved tools. */
  tools?: ToolRecord
  /** Per-turn hook that can override prompt input, contexts, tools, and budget. */
  prepare?: (
    args: ConvexAgentPrepareArgs<TPrompt>,
  ) => ConvexAgentPrepareResult<TPrompt> | Promise<ConvexAgentPrepareResult<TPrompt>>
  /** Request-scoped store factory. */
  store?: (ctx: unknown) => CruxStore | Promise<CruxStore>
  /** Namespace override for Convex-profile memory and skill state. */
  namespace?:
    | string
    | ((args: {
        input: Record<string, unknown>
        promptId?: string
        target?: ConvexRuntimeTarget
      }) => string | Promise<string>)
}

/** Complete config for a profile-backed Convex Agent helper. */
export type ConvexAgentConfig<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>> =
  ConvexAgentBaseConfig<TPrompt> & ConvexAgentModelConfig

/** Public profile-backed Convex Agent helper returned by `convexAgent()`. */
export interface CruxConvexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>> {
  /** Public agent name. */
  readonly name: string
  /** Prompt resolved for each turn. */
  readonly prompt: TPrompt
  /** Resolve the prompt and execute a non-streaming text generation turn. */
  generateText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  /** Resolve the prompt and execute a streaming text generation turn. */
  streamText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  /** Resolve the prompt without invoking Convex Agent generation. */
  resolve(ctx: unknown, target: ConvexRuntimeTarget, args: ConvexAgentCallArgs<TPrompt>): Promise<ResolvedPrompt>
  /** Continue an existing Convex Agent thread through the Crux lifecycle. */
  continueThread(
    ctx: unknown,
    target: ConvexAgentThreadTarget,
    args: ConvexAgentCallArgs<TPrompt>,
  ): Promise<{ thread: CruxConvexThread }>
}

export type {
  ConvexAgentCallArgs,
  ConvexAgentContextMessage,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentThreadTarget,
  CruxConvexThread,
  PromptInput,
}
