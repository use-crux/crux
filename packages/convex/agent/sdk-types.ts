import { Agent as ConvexAgent } from '@convex-dev/agent'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ResolvedPrompt } from '@use-crux/core'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import type { ComponentApi } from '../src/component/_generated/component'
import type { ConvexRuntimeTarget } from '../runtime'
import type {
  ConvexGenerateObjectArgs,
  ConvexGenerateObjectOptions,
  ConvexGenerateObjectResult,
  ConvexGenerateTextArgs,
  ConvexGenerateTextOptions,
  ConvexGenerateTextResult,
  ConvexStreamObjectArgs,
  ConvexStreamObjectOptions,
  ConvexStreamObjectResult,
  ConvexStreamTextArgs,
  ConvexStreamTextOptions,
  ConvexStreamTextResult,
} from './convex-agent-method-types'
import type {
  ConvexAgentCallArgs,
  ConvexAgentObserveArgs,
  ConvexAgentObserveConfig,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentPersistenceConfig,
  ConvexAgentThreadTarget,
  CruxConvexThread,
  AnyConvexPrompt,
  PromptInput,
} from './lifecycle-types'
import type { ConvexAgentContextMessage } from './driver'
import type { ConvexAgentDriver } from './driver'
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

/** Crux runtime options for profile-backed Convex Agent turns. */
export interface ConvexAgentCruxRuntimeConfig {
  /** Request-scoped storage factory used by prompt memory, skills, and Crux tools. */
  storage?: (ctx: unknown) => Storage | RecordStore | Promise<Storage | RecordStore>
  /** Namespace override for Convex-profile memory and skill state. */
  namespace?:
    | string
    | ((args: {
        input: Record<string, unknown>
        promptId?: string
        target?: ConvexRuntimeTarget
      }) => string | Promise<string>)
}

/** Crux-owned lifecycle controls for `convexAgent()`. */
export interface ConvexAgentCruxConfig<TPrompt extends AnyConvexPrompt> {
  /** Advanced adapter override used by tests and custom Convex Agent runtimes. */
  driver?: ConvexAgentDriver
  /** Runtime binding for request-scoped Crux storage and namespace state. */
  runtime?: ConvexAgentCruxRuntimeConfig
  /** Profile `agent.run` observability controls. */
  observe?: ConvexAgentObserveConfig
  /** Best-effort post-turn skill and memory persistence controls. */
  persistence?: ConvexAgentPersistenceConfig
  /** Per-turn hook that can override prompt input, contexts, tools, and budget. */
  prepare?: (
    args: ConvexAgentPrepareArgs<TPrompt>,
  ) => ConvexAgentPrepareResult<TPrompt> | Promise<ConvexAgentPrepareResult<TPrompt>>
}

/** Public `convexAgent()` configuration before model binding. */
export interface ConvexAgentBaseConfig<
  TPrompt extends AnyConvexPrompt,
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
  /** Crux-owned lifecycle controls. Prefer this namespace for new code. */
  crux?: ConvexAgentCruxConfig<TPrompt>
}

/** Complete config for a profile-backed Convex Agent helper. */
export type ConvexAgentConfig<TPrompt extends AnyConvexPrompt> =
  ConvexAgentBaseConfig<TPrompt> & ConvexAgentModelConfig

/** Public profile-backed Convex Agent helper returned by `convexAgent()`. */
export interface CruxConvexAgent<TPrompt extends AnyConvexPrompt> {
  /** Public agent name. */
  readonly name: string
  /** Prompt resolved for each turn. */
  readonly prompt: TPrompt
  /** Crux-only diagnostics and lifecycle helpers, separated from the Convex Agent-shaped surface. */
  readonly crux: {
    /** Resolve the prompt without invoking Convex Agent generation. */
    resolve(ctx: unknown, target: ConvexRuntimeTarget, args: ConvexAgentCallArgs<TPrompt>): Promise<ResolvedPrompt>
  }
  /**
   * Resolve the Crux prompt and execute a non-streaming Convex Agent turn.
   *
   * `args` follows upstream `Agent.generateText()` args except Crux owns
   * `system`, `prompt`, `messages`, and `tools`. Provide typed prompt `input`
   * plus normal generation settings such as `temperature` or `promptMessageId`.
   */
  generateText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt, ConvexGenerateTextArgs>,
    options?: ConvexGenerateTextOptions,
  ): ConvexGenerateTextResult
  /**
   * Resolve the Crux prompt and execute a streaming Convex Agent turn.
   *
   * `args` follows upstream `Agent.streamText()` args except Crux owns
   * `system`, `prompt`, `messages`, and `tools`. Provide typed prompt `input`
   * plus normal streaming settings such as `stopWhen` or callbacks.
   */
  streamText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt, ConvexStreamTextArgs>,
    options?: ConvexStreamTextOptions,
  ): ConvexStreamTextResult
  /**
   * Resolve the Crux prompt and execute a structured Convex Agent turn.
   *
   * `args` follows upstream `Agent.generateObject()` args except Crux owns the
   * resolved prompt fields. When the prompt declares `output`, Crux injects the
   * resolved schema into the Convex Agent call.
   */
  generateObject(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt, ConvexGenerateObjectArgs>,
    options?: ConvexGenerateObjectOptions,
  ): ConvexGenerateObjectResult
  /**
   * Resolve the Crux prompt and execute a streaming structured Convex Agent turn.
   *
   * `args` follows upstream `Agent.streamObject()` args except Crux owns the
   * resolved prompt fields. When the prompt declares `output`, Crux injects the
   * resolved schema into the Convex Agent call.
   */
  streamObject(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt, ConvexStreamObjectArgs>,
    options?: ConvexStreamObjectOptions,
  ): ConvexStreamObjectResult
  /**
   * Resolve the prompt without invoking Convex Agent generation.
   *
   * @deprecated Use `agent.crux.resolve()` so Crux-only diagnostics stay
   * separate from the Convex Agent-shaped generation surface.
   */
  resolve(ctx: unknown, target: ConvexRuntimeTarget, args: ConvexAgentCallArgs<TPrompt>): Promise<ResolvedPrompt>
  /**
   * Continue an existing Convex Agent thread through the Crux lifecycle.
   *
   * Per-turn Crux `input` belongs on `thread.generateText()`,
   * `thread.streamText()`, `thread.generateObject()`, or
   * `thread.streamObject()`, matching Convex Agent's continuation call order.
   */
  continueThread(ctx: unknown, target: ConvexAgentThreadTarget): Promise<{ thread: CruxConvexThread<TPrompt> }>
}

export type {
  ConvexAgentCallArgs,
  ConvexAgentContextMessage,
  ConvexAgentDriver,
  ConvexAgentObserveArgs,
  ConvexAgentObserveConfig,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentPersistenceConfig,
  ConvexAgentThreadTarget,
  ConvexGenerateObjectArgs,
  ConvexGenerateObjectOptions,
  ConvexGenerateObjectResult,
  ConvexGenerateTextArgs,
  ConvexGenerateTextOptions,
  ConvexGenerateTextResult,
  ConvexStreamObjectArgs,
  ConvexStreamObjectOptions,
  ConvexStreamObjectResult,
  ConvexStreamTextArgs,
  ConvexStreamTextOptions,
  ConvexStreamTextResult,
  CruxConvexThread,
  PromptInput,
}
