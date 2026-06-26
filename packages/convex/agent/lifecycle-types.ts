import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ContextEntry, MergedInput, Prompt, PromptConfig, ResolvedPrompt } from '@use-crux/core'
import type { CruxStore } from '@use-crux/core/store'
import type { z } from 'zod'
import type { ComponentApi } from '../src/component/_generated/component'
import type { ConvexRuntimeTarget } from '../runtime'
import type {
  ConvexAgentContextMessage,
  ConvexAgentContextSnapshot,
  ConvexAgentDriver,
  ConvexAgentPassthroughOptions,
  ConvexAgentSession,
} from './driver'

/** Prompt shape supported by the Convex runtime profile. */
export type AnyConvexPrompt = Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>

/** Infer the merged input expected by a prompt and its context list. */
export type PromptInput<TPrompt> =
  TPrompt extends Prompt<infer TOwnInput, z.ZodType | undefined, infer TContexts>
    ? MergedInput<TOwnInput, TContexts>
    : never

/** Operations emitted by the profile-backed lifecycle. */
export type ConvexAgentOperation = 'resolve' | 'generateText' | 'streamText'

/** Target for continuing a persisted Convex Agent thread. */
export type ConvexAgentThreadTarget = ConvexRuntimeTarget & {
  readonly threadId: string
}

/** Arguments accepted by `generateText()`, `streamText()`, and `resolve()`. */
export type ConvexAgentCallArgs<TPrompt extends AnyConvexPrompt> = {
  readonly input: PromptInput<TPrompt>
  readonly tokenBudget?: number
} & Record<string, unknown>

/** Messages exposed to a profile-backed agent `prepare()` callback. */
export interface ConvexAgentPrepareMessages {
  readonly all: readonly ConvexAgentContextMessage[]
  readonly search: readonly ConvexAgentContextMessage[]
  readonly recent: readonly ConvexAgentContextMessage[]
  readonly inputMessages: readonly ConvexAgentContextMessage[]
  readonly inputPrompt: readonly ConvexAgentContextMessage[]
  readonly existingResponses: readonly ConvexAgentContextMessage[]
}

/** Arguments passed to a profile-backed agent `prepare()` callback. */
export interface ConvexAgentPrepareArgs<TPrompt extends AnyConvexPrompt> {
  readonly ctx: unknown
  readonly target: ConvexRuntimeTarget
  readonly args: ConvexAgentCallArgs<TPrompt>
  readonly input: PromptInput<TPrompt>
  readonly messages?: ConvexAgentPrepareMessages
}

/** Optional overrides returned by a profile-backed agent `prepare()` callback. */
export interface ConvexAgentPrepareResult<TPrompt extends AnyConvexPrompt> {
  readonly input?: PromptInput<TPrompt> | Record<string, unknown>
  readonly use?: readonly ContextEntry[]
  readonly prompt?: AnyConvexPrompt
  readonly tools?: Record<string, unknown>
  readonly tokenBudget?: number
  readonly captureMessages?: readonly ConvexAgentContextMessage[]
}

/**
 * Model field accepted by the profile-backed lifecycle.
 *
 * `languageModel` is preferred for Convex Agent parity, while `model` remains
 * available as a compatibility alias for existing Crux Convex callers.
 */
export type ProfileBackedAgentModelConfig =
  | {
      readonly languageModel: LanguageModelV3
      readonly model?: LanguageModelV3
    }
  | {
      readonly languageModel?: LanguageModelV3
      readonly model: LanguageModelV3
    }

/** Configuration for the internal profile-backed lifecycle, before model binding. */
export interface ProfileBackedAgentLifecycleBaseConfig<
  TPrompt extends AnyConvexPrompt,
> extends ConvexAgentPassthroughOptions {
  /** Driver that adapts the lifecycle to `@convex-dev/agent`. */
  readonly driver: ConvexAgentDriver
  /** Convex components used by the Crux and Convex Agent runtimes. */
  readonly components: {
    readonly crux: ComponentApi
    readonly agent: unknown
  }
  /** Public agent name. Defaults to the prompt id. */
  readonly name?: string
  /** Crux prompt resolved for each turn. */
  readonly prompt: TPrompt
  /** Default token budget for prompt resolution. */
  readonly tokenBudget?: number
  /** Extra tools added to every turn after prompt-resolved tools. */
  readonly tools?: Record<string, unknown>
  /** Per-turn hook that can override prompt input, contexts, tools, and budget. */
  readonly prepare?: (
    args: ConvexAgentPrepareArgs<TPrompt>,
  ) => ConvexAgentPrepareResult<TPrompt> | Promise<ConvexAgentPrepareResult<TPrompt>>
  /** Request-scoped store factory. */
  readonly store?: (ctx: unknown) => CruxStore | Promise<CruxStore>
  /** Namespace override for Convex-profile memory and skill state. */
  readonly namespace?:
    | string
    | ((args: {
        readonly input: Record<string, unknown>
        readonly promptId?: string
        readonly target?: ConvexRuntimeTarget
      }) => string | Promise<string>)
}

/** Configuration for the internal profile-backed lifecycle. */
export type ProfileBackedAgentLifecycleConfig<TPrompt extends AnyConvexPrompt> =
  ProfileBackedAgentLifecycleBaseConfig<TPrompt> & ProfileBackedAgentModelConfig

/** Request passed to one lifecycle turn. */
export interface AgentTurnRequest<TPrompt extends AnyConvexPrompt> {
  readonly ctx: unknown
  readonly target: ConvexRuntimeTarget
  readonly args: ConvexAgentCallArgs<TPrompt>
  readonly options?: Record<string, unknown>
}

/** Request passed when continuing an existing Convex Agent thread. */
export interface AgentThreadRequest<TPrompt extends AnyConvexPrompt> {
  readonly ctx: unknown
  readonly target: ConvexAgentThreadTarget
  readonly args: ConvexAgentCallArgs<TPrompt>
}

/** Prepared state passed from Crux prompt resolution to the driver. */
export interface PreparedAgentCall {
  readonly session: ConvexAgentSession
  readonly resolved: ResolvedPrompt
  readonly callArgs: Record<string, unknown>
  readonly convexTools: Record<string, unknown>
  readonly input: Record<string, unknown>
  readonly captureMessages?: readonly ConvexAgentContextMessage[]
}

/** Convex-Agent-shaped thread returned by `continueThread()`. */
export interface CruxConvexThread {
  readonly threadId: string
  getMetadata(): Promise<unknown>
  updateMetadata(patch: Record<string, unknown>): Promise<unknown>
  generateText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
  streamText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

/** Internal lifecycle facade used by the public `convexAgent()` wrapper. */
export interface ProfileBackedAgentLifecycle<TPrompt extends AnyConvexPrompt> {
  readonly name: string
  resolveOnly(request: AgentTurnRequest<TPrompt>): Promise<ResolvedPrompt>
  invokeText(request: AgentTurnRequest<TPrompt>): Promise<unknown>
  invokeStream(request: AgentTurnRequest<TPrompt>): Promise<unknown>
  continueThread(request: AgentThreadRequest<TPrompt>): Promise<{ thread: CruxConvexThread }>
}

/** Type alias for prompt config reuse when adding runtime contexts. */
export type AnyConvexPromptConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>

/** Captured context snapshot plus the original call arguments for a continued turn. */
export interface ThreadContextPreparation {
  readonly snapshot: ConvexAgentContextSnapshot
  readonly callArgs: Record<string, unknown>
  readonly options?: Record<string, unknown>
}
