/**
 * `adapter()` — factory for creating provider adapters.
 *
 * Accepts an `AdapterSpec` (provider-specific hooks) and returns a factory
 * `(client: TClient) => CruxAdapter`. The adapter handles prompt resolution,
 * tool loops, settings mapping, and exposes `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * This is the shared infrastructure that future adapter rewrites will use.
 * Fallback chains and devtools hooks will be wired in here.
 *
 * @module
 */

import type { GenerationSettings, TraceMeta, AnyPrompt } from '../types'

/**
 * Loosely-typed resolve options used at the adapter boundary.
 *
 * The adapter is generic over `AnyPrompt`, so the strongly-typed
 * `ResolveOptions<TOwnInput, TContexts>` shape is unreachable here — the
 * concrete input shape is only known to the original prompt definition.
 * We narrow from `unknown` once and reuse this contract for every call.
 */
type AdapterResolveOpts = Parameters<AnyPrompt['resolve']>[0]
import type { Message } from '../messages'
import type { AdapterSpec } from './spec'
import type { StreamHandle } from './types'
import { createCompositions } from '../agent/create-compositions'
import type { AgentExecutor } from '../agent/executor'
import type { ValidationRetryOptions } from '../validation-retry'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { ToolMiddleware } from '../tool-middleware'
import { coreStepDialect, createAdapterExecution } from './execution/session'

// ─────────────────────────────────────────────────────────────────
// Generate Options
// ─────────────────────────────────────────────────────────────────

/** Options for adapter `generate()` calls. */
export interface AdapterGenerateOptions<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  /** Model identifier passed to the provider's API. */
  model: string
  /** Input for the prompt. */
  input?: Record<string, unknown>
  /** Provider identifier for adaptation matching. Defaults to spec.providerId. */
  provider?: string
  /** Token budget for system message. */
  tokenBudget?: number
  /** Maximum tool loop iterations. Default: 10. */
  maxSteps?: number
  /** Additional generation settings at call-site (highest precedence). */
  settings?: GenerationSettings
  /** Provider-specific extra options. */
  extra?: TExtra
  /** Additional messages to prepend (e.g., conversation history). */
  messages?: Message[]
  /** Additional tools to merge at call time after prompt/context tools. */
  tools?: Record<string, unknown>
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /**
   * Validation-feedback retry for structured output.
   * When set, failed Zod schema validation triggers a retry with
   * the error injected as a corrective message. Each retry counts
   * as a step against the `maxSteps` budget.
   */
  validationRetry?: ValidationRetryOptions
  /**
   * Semantic constraints to check after structural (Zod) validation passes.
   * All constraints run in parallel; combined feedback is injected on retry.
   * Merged with per-prompt, context-level, and global constraints (per-call wins).
   */
  constraints?: Constraint[]
  /**
   * Shared cap on total constraint retries across all constraints.
   * Individual constraints also have their own `maxRetries`.
   */
  constraintMaxRetries?: number
  /**
   * Guardrails to run on input/output during generation.
   * Merged with per-prompt, context-level, and global guardrails (per-call wins).
   */
  guardrails?: Guardrail[]
}

/** Options for adapter `stream()` calls. */
export interface AdapterStreamOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> extends AdapterGenerateOptions<TExtra> {}

// ─────────────────────────────────────────────────────────────────
// Generate Result
// ─────────────────────────────────────────────────────────────────

/** Result of an adapter `generate()` call. */
export interface AdapterGenerateResult<TRawResponse> {
  /** The raw SDK response (provider-specific). */
  raw: TRawResponse
  /** Extracted text from the response. */
  text: string
  /** Normalized metadata (usage, finish reason, tool calls, etc.). */
  _meta: TraceMeta
  /** Number of tool loop iterations performed. */
  steps: number
  /** Provider-agnostic Crux message history, including approval request/resume messages. */
  messages: Message[]
}

// ─────────────────────────────────────────────────────────────────
// CruxAdapter
// ─────────────────────────────────────────────────────────────────

/** The adapter interface returned by the factory. */
export interface CruxAdapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Provider identifier from the spec. */
  readonly providerId: string

  /** Execute a prompt (non-streaming) with automatic tool loop. */
  generate(prompt: AnyPrompt, opts: AdapterGenerateOptions<TExtra>): Promise<AdapterGenerateResult<TRawResponse>>

  /** Execute a prompt (streaming). */
  stream(prompt: AnyPrompt, opts: AdapterStreamOptions<TExtra>): Promise<StreamHandle<TRawStream>>

  /** Run multiple agents concurrently and merge results. */
  parallel: ReturnType<typeof createCompositions>['parallel']

  /** Chain agents sequentially with typed data flow. */
  pipeline: ReturnType<typeof createCompositions>['pipeline']

  /** Run multiple agents and pick a winner via voting. */
  consensus: ReturnType<typeof createCompositions>['consensus']

  /** Run a swarm of agents with peer-to-peer routing via tool calls. */
  swarm: ReturnType<typeof createCompositions>['swarm']
}

// ─────────────────────────────────────────────────────────────────
// adapter
// ─────────────────────────────────────────────────────────────────

/**
 * Create a provider adapter from an `AdapterSpec`.
 *
 * Returns a factory function: `(client: TClient) => CruxAdapter`.
 * The returned adapter has `generate()`, `stream()`, and composition
 * methods (parallel, pipeline, consensus, swarm).
 *
 * @param spec - Provider-specific adapter specification.
 * @returns A factory that creates adapter instances bound to a client.
 *
 * @example
 * ```ts
 * const createMyAdapter = adapter({
 *   providerId: 'my-provider',
 *   call: async (client, args) => { ... },
 *   stream: async (client, args) => { ... },
 *   appendToolRound: (msgs, resp, results) => [...msgs, ...],
 *   mapSettings: (s) => ({ temperature: s.temperature }),
 * })
 *
 * const adapter = createMyAdapter(myClient)
 * const result = await adapter.generate(myPrompt, { model: 'gpt-4o', input: { ... } })
 * ```
 */
export function adapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>,
): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> {
  return (client: TClient): CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> => {
    const execution = createAdapterExecution(coreStepDialect(spec, client))

    // ── generate() ──────────────────────────────────────────────

    async function generate(
      prompt: AnyPrompt,
      opts: AdapterGenerateOptions<TExtra>,
    ): Promise<AdapterGenerateResult<TRawResponse>> {
      return (await execution.generate({
        prompt,
        model: opts.model,
        modelInfo: { provider: opts.provider ?? spec.providerId, modelId: opts.model },
        input: opts.input,
        provider: opts.provider,
        tokenBudget: opts.tokenBudget,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        extra: opts.extra,
        messages: opts.messages,
        tools: opts.tools,
        toolMiddleware: opts.toolMiddleware,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
      })) as AdapterGenerateResult<TRawResponse>
    }

    // ── stream() ──────────────────────────────────────────────

    async function streamFn(prompt: AnyPrompt, opts: AdapterStreamOptions<TExtra>): Promise<StreamHandle<TRawStream>> {
      return (await execution.stream({
        prompt,
        model: opts.model,
        modelInfo: { provider: opts.provider ?? spec.providerId, modelId: opts.model },
        input: opts.input,
        provider: opts.provider,
        tokenBudget: opts.tokenBudget,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        extra: opts.extra,
        messages: opts.messages,
        tools: opts.tools,
        toolMiddleware: opts.toolMiddleware,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
      })) as StreamHandle<TRawStream>
    }

    // ── Agent executor ──────────────────────────────────────────

    const executor: AgentExecutor = async (agent, options) => {
      const model = (agent.model as string) ?? (options.model as string)
      const start = Date.now()

      // Merge agent tools + composition-level tools into the prompt
      // so the tool loop can pick them up from the resolved prompt.
      const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) }
      const promptWithTools: AnyPrompt =
        Object.keys(mergedTools).length > 0
          ? (Object.freeze({
              ...agent.prompt,
              tools: mergedTools,
              resolve: async (resolveOpts: AdapterResolveOpts) => {
                const resolved = await agent.prompt.resolve(resolveOpts)
                return { ...resolved, tools: { ...(resolved.tools ?? {}), ...mergedTools } }
              },
            }) as unknown as AnyPrompt)
          : agent.prompt

      const generateOpts: AdapterGenerateOptions<TExtra> = {
        model,
        input: options.input as Record<string, unknown>,
        maxSteps: options.maxSteps,
        validationRetry: options.validationRetry,
        extra: {} as TExtra,
      }

      const result = await generate(promptWithTools, generateOpts)

      return {
        agentId: agent.id,
        output: result.text,
        durationMs: Date.now() - start,
        usage: result._meta.usage
          ? {
              inputTokens: result._meta.usage.inputTokens,
              outputTokens: result._meta.usage.outputTokens,
              totalTokens: result._meta.usage.totalTokens,
            }
          : undefined,
      }
    }

    const compositions = createCompositions(executor)

    // ── Return frozen adapter ──────────────────────────────────

    return Object.freeze({
      providerId: spec.providerId,
      generate,
      stream: streamFn,
      parallel: compositions.parallel,
      pipeline: compositions.pipeline,
      consensus: compositions.consensus,
      swarm: compositions.swarm,
    })
  }
}
