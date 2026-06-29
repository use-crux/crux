import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ContextEntry, MergedInput, Prompt, PromptConfig, ResolvedPrompt } from '@use-crux/core'
import type { CruxAttributes } from '@use-crux/core/observability'
import type { CruxStore } from '@use-crux/core/store'
import type { z } from 'zod'
import type { ComponentApi } from '../src/component/_generated/component'
import type { ConvexRuntimeTarget } from '../runtime'
import type {
  ConvexGenerateObjectArgs,
  ConvexGenerateTextArgs,
  ConvexStreamObjectArgs,
  ConvexStreamTextArgs,
  ConvexThreadGenerateObjectArgs,
  ConvexThreadGenerateObjectOptions,
  ConvexThreadGenerateObjectResult,
  ConvexThreadGenerateTextArgs,
  ConvexThreadGenerateTextOptions,
  ConvexThreadGenerateTextResult,
  ConvexThreadStreamObjectArgs,
  ConvexThreadStreamObjectOptions,
  ConvexThreadStreamObjectResult,
  ConvexThreadStreamTextArgs,
  ConvexThreadStreamTextOptions,
  ConvexThreadStreamTextResult,
} from './convex-agent-method-types'
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
export type ConvexAgentOperation = 'resolve' | 'generateText' | 'streamText' | 'generateObject' | 'streamObject'

/** Target for continuing a persisted Convex Agent thread. */
export type ConvexAgentThreadTarget = ConvexRuntimeTarget & {
  readonly threadId: string
}

type CruxOwnedConvexArgKey = 'model' | 'system' | 'prompt' | 'messages' | 'tools'

/**
 * Convex-Agent-shaped turn arguments with Crux prompt input added.
 *
 * Crux owns `system`, resolved `prompt`/`messages`, and resolved `tools`, so
 * those upstream fields are intentionally omitted from the public call shape.
 * Callers provide prompt `input` alongside normal generation settings such as
 * `temperature`, `stopWhen`, `promptMessageId`, or provider options.
 */
export type ConvexAgentCallArgs<TPrompt extends AnyConvexPrompt, TConvexArgs extends object = ConvexGenerateTextArgs> =
  Omit<TConvexArgs, CruxOwnedConvexArgKey> & {
    readonly input: PromptInput<TPrompt>
    readonly tokenBudget?: number
  }

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

/** Best-effort post-turn persistence controls for profile-backed agent calls. */
export interface ConvexAgentPersistenceConfig {
  /** Persist active skill snapshots after each successful turn. Defaults to true. */
  readonly skills?: boolean
  /** Capture resolved memory blocks after each successful turn. Defaults to true. */
  readonly memory?: boolean
}

/** Context available when customizing profile-backed Convex Agent observability. */
export interface ConvexAgentObserveArgs {
  /** Public agent name configured for the span. */
  readonly agentName: string
  /** Stable prompt id, when the configured prompt has one. */
  readonly promptId?: string
  /** Lifecycle operation currently being observed. */
  readonly operation: ConvexAgentOperation
  /** Convex Agent target for the current operation. */
  readonly target: ConvexRuntimeTarget
}

/** Controls for the profile-backed `agent.run` observability span. */
export interface ConvexAgentObserveConfig {
  /** Enable or disable the profile `agent.run` span. Defaults to true. */
  readonly enabled?: boolean
  /** Override the profile `agent.run` span name. Defaults to the public agent name. */
  readonly name?: string | ((args: ConvexAgentObserveArgs) => string | Promise<string>)
  /** Add attributes to the profile `agent.run` span start and end records. */
  readonly attributes?:
    | CruxAttributes
    | ((args: ConvexAgentObserveArgs) => CruxAttributes | Promise<CruxAttributes>)
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
export type ProfileBackedAgentLifecycleBaseConfig<TPrompt extends AnyConvexPrompt> =
  ProfileBackedAgentLifecycleCommonConfig<TPrompt> &
    (
      | {
          /** Convex components used by the Crux and Convex Agent runtimes. */
          readonly components: {
            readonly crux: ComponentApi
            readonly agent: unknown
          }
          /** Request-scoped store factory. */
          readonly store?: (ctx: unknown) => CruxStore | Promise<CruxStore>
        }
      | {
          /** Convex Agent component plus an optional Crux component when a custom store is supplied. */
          readonly components: {
            readonly crux?: ComponentApi
            readonly agent: unknown
          }
          /** Request-scoped store factory. */
          readonly store: (ctx: unknown) => CruxStore | Promise<CruxStore>
        }
    )

interface ProfileBackedAgentLifecycleCommonConfig<TPrompt extends AnyConvexPrompt>
  extends ConvexAgentPassthroughOptions {
  /** Driver that adapts the lifecycle to `@convex-dev/agent`. */
  readonly driver: ConvexAgentDriver
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
  /** Namespace override for Convex-profile memory and skill state. */
  readonly namespace?:
    | string
    | ((args: {
        readonly input: Record<string, unknown>
        readonly promptId?: string
        readonly target?: ConvexRuntimeTarget
      }) => string | Promise<string>)
  /** Profile `agent.run` observability controls. */
  readonly observe?: ConvexAgentObserveConfig
  /** Best-effort post-turn persistence controls. */
  readonly persistence?: ConvexAgentPersistenceConfig
}

/** Configuration for the internal profile-backed lifecycle. */
export type ProfileBackedAgentLifecycleConfig<TPrompt extends AnyConvexPrompt> =
  ProfileBackedAgentLifecycleBaseConfig<TPrompt> & ProfileBackedAgentModelConfig

/** Request passed to one lifecycle turn. */
export interface AgentTurnRequest<TPrompt extends AnyConvexPrompt, TArgs extends object = ConvexGenerateTextArgs> {
  readonly ctx: unknown
  readonly target: ConvexRuntimeTarget
  readonly args: ConvexAgentCallArgs<TPrompt, TArgs>
  readonly options?: Record<string, unknown>
}

/** Request passed when continuing an existing Convex Agent thread. */
export interface AgentThreadRequest<TPrompt extends AnyConvexPrompt> {
  readonly ctx: unknown
  readonly target: ConvexAgentThreadTarget
}

/** Prepared state passed from Crux prompt resolution to the driver. */
export interface PreparedAgentCall {
  readonly session: ConvexAgentSession
  readonly resolved: ResolvedPrompt
  readonly callArgs: Record<string, unknown>
  readonly convexTools: Record<string, unknown>
  readonly input: Record<string, unknown>
  readonly persistence?: ConvexAgentPersistenceConfig
  readonly captureMessages?: readonly ConvexAgentContextMessage[]
}

/** Convex-Agent-shaped thread returned by `continueThread()`. */
export interface CruxConvexThread<TPrompt extends AnyConvexPrompt> {
  readonly threadId: string
  getMetadata(): Promise<unknown>
  updateMetadata(patch: Record<string, unknown>): Promise<unknown>
  generateText(
    args: ConvexAgentCallArgs<TPrompt, ConvexThreadGenerateTextArgs>,
    options?: ConvexThreadGenerateTextOptions,
  ): ConvexThreadGenerateTextResult
  streamText(
    args: ConvexAgentCallArgs<TPrompt, ConvexThreadStreamTextArgs>,
    options?: ConvexThreadStreamTextOptions,
  ): ConvexThreadStreamTextResult
  generateObject(
    args: ConvexAgentCallArgs<TPrompt, ConvexThreadGenerateObjectArgs>,
    options?: ConvexThreadGenerateObjectOptions,
  ): ConvexThreadGenerateObjectResult
  streamObject(
    args: ConvexAgentCallArgs<TPrompt, ConvexThreadStreamObjectArgs>,
    options?: ConvexThreadStreamObjectOptions,
  ): ConvexThreadStreamObjectResult
}

/** Internal lifecycle facade used by the public `convexAgent()` wrapper. */
export interface ProfileBackedAgentLifecycle<TPrompt extends AnyConvexPrompt> {
  readonly name: string
  resolveOnly(request: AgentTurnRequest<TPrompt>): Promise<ResolvedPrompt>
  invokeText(request: AgentTurnRequest<TPrompt, ConvexGenerateTextArgs>): Promise<unknown>
  invokeStream(request: AgentTurnRequest<TPrompt, ConvexStreamTextArgs>): Promise<unknown>
  invokeObject(request: AgentTurnRequest<TPrompt, ConvexGenerateObjectArgs>): Promise<unknown>
  invokeObjectStream(request: AgentTurnRequest<TPrompt, ConvexStreamObjectArgs>): Promise<unknown>
  continueThread(request: AgentThreadRequest<TPrompt>): Promise<{ thread: CruxConvexThread<TPrompt> }>
}

/** Type alias for prompt config reuse when adding runtime contexts. */
export type AnyConvexPromptConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>

/** Captured context snapshot plus the original call arguments for a continued turn. */
export interface ThreadContextPreparation {
  readonly snapshot: ConvexAgentContextSnapshot
  readonly callArgs: Record<string, unknown>
  readonly options?: Record<string, unknown>
}
