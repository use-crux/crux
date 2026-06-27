/**
 * `executorAdapter()` — lower-level factory for loop-owned execution IR.
 *
 * The counterpart of `adapter()` for SDKs that drive their own multi-step
 * tool loop (e.g. the Vercel AI SDK). Accepts an `ExecutorSpec` and returns
 * a factory `(client: TClient) => CruxExecutor`.
 *
 * Provider packages should normally use
 * `defineProviderRuntime({ ownership: 'loop-owned', loop })`, which compiles
 * into this IR.
 *
 * The factory owns the entire policy layer so specs stay mechanical:
 * prompt resolution, routing dispatch (`fallback()`/`router()`/`cascade()`
 * are unwrapped *before* the spec ever sees a model), validation retry,
 * constraints, guardrails, the tool-approval protocol, tool
 * instrumentation, timeouts, orchestration middleware/observability,
 * memory capture, and agent compositions.
 *
 * @module
 */

import type { AnyPrompt, GenerationSettings, TraceMeta } from '../types'
import type { Message } from '../generation/messages'
import type { ExecutorSpec } from './executor-spec'
import type { ExecutorStreamHandle, StepObserver } from './executor-types'
import type { ApprovalRequestInfo } from './tool/approval'
import type { ValidationRetryOptions } from '../generation/validation-retry'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import { executeFallbackLoop } from '../generation/fallback-loop'
import { isFallback } from '../generation/fallback'
import type { FallbackModel } from '../generation/fallback'
import { isRouter, isCascade } from '../routing'
import { resolveModel } from '../routing/resolve'
import type { AnyRouterModel, CascadeModel } from '../routing'
import type { ToolMiddleware } from '../tool-middleware'
import { createCompositions } from '../agent/create-compositions'
import type { AgentExecutor } from '../agent/executor'
import { createAdapterExecution, sdkLoopDialect } from './execution/session'

// ─────────────────────────────────────────────────────────────────
// Options & results
// ─────────────────────────────────────────────────────────────────

/**
 * The model argument accepted by executor `generate()`/`stream()`: a plain
 * SDK model or any core routing wrapper around one. Routing is resolved by
 * the factory; the spec only ever receives a plain `TModel`.
 */
export type ExecutorModelArg<TModel> = TModel | FallbackModel<TModel> | AnyRouterModel<TModel> | CascadeModel<TModel>

/** Options for executor `generate()` calls. */
export interface ExecutorGenerateOptions<TModel> {
  /** The model to use — plain, `fallback()`, `router()`, or `cascade()`. */
  model: ExecutorModelArg<TModel>
  /** Input for the prompt. */
  input?: Record<string, unknown>
  /** Additional tools merged at call time (highest precedence). */
  tools?: Record<string, unknown>
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /**
   * Message history override — used for conversation continuations and for
   * resuming after a tool-approval decision (append a
   * `tool-approval-response` message to the suspended result's history).
   */
  messages?: Message[]
  /** Maximum loop steps. Refunded steps (e.g. `LoadSkill`) don't count. @defaultValue 10 */
  maxSteps?: number
  /** Call-site generation settings (highest precedence). */
  settings?: GenerationSettings
  /** Token budget for the system message. */
  tokenBudget?: number
  /**
   * Hard wall-clock timeout in milliseconds. Enforced by core (the call
   * rejects with an `AbortError`) and forwarded to the SDK as an
   * `AbortSignal` so the underlying request is cancelled too.
   */
  timeoutMs?: number
  /**
   * Validation-feedback retry for structured output. Each retry makes one
   * additional `attemptStructured` call with the Zod errors injected as a
   * corrective message.
   */
  validationRetry?: ValidationRetryOptions
  /** Semantic constraints checked after structural validation passes. */
  constraints?: Constraint[]
  /** Shared cap on total constraint retries across all constraints. */
  constraintMaxRetries?: number
  /** Guardrails to run on input/output during generation. */
  guardrails?: Guardrail[]
  /**
   * Per-step steering observer. Runs after the factory's own steering
   * (skill re-resolution); on conflict, `stop` wins over `amend` wins over
   * `continue`, and caller `amend` fields override factory ones.
   */
  observer?: StepObserver
  /** Restrict which tools the model may call. */
  activeTools?: readonly string[]
  /** Spec-specific passthrough options (e.g. AI SDK `toolChoice`). */
  extra?: Record<string, unknown>
}

/** Options for executor `stream()` calls. */
export interface ExecutorStreamOptions<TModel> extends ExecutorGenerateOptions<TModel> {}

/**
 * Result of an executor `generate()` call.
 *
 * Suspension is signalled in-band, mirroring `adapter()`: when a tool
 * required approval, `_meta.finishReason` is `'tool_approval_required'`,
 * `pendingApprovals` carries the minted requests, and `messages` ends with
 * the approval-request message — persist it, collect a decision, append a
 * `tool-approval-response`, and call `generate()` again with `messages`.
 */
export interface ExecutorGenerateResult<TRawResponse> {
  /** The SDK's own result object. `undefined` only when suspended on approval. */
  raw: TRawResponse | undefined
  /** Final assistant text (or serialized JSON for structured output). */
  text: string
  /** The parsed, schema-valid object — present for structured prompts. */
  object?: unknown
  /** Normalized metadata (usage, finish reason, cost, audits, routing). */
  _meta: TraceMeta
  /** Budget-consuming steps taken (validation retries count; refunds don't). */
  steps: number
  /** Canonical message history, including approval request/resume messages. */
  messages: Message[]
  /** Approval requests awaiting a decision — present only when suspended. */
  pendingApprovals?: readonly ApprovalRequestInfo[]
}

/** The executor interface returned by the factory. */
export interface CruxExecutor<TClient, TModel, TRawResponse = unknown, TRawStream = unknown> {
  /** Executor identifier from the spec. */
  readonly executorId: string

  /** Execute a prompt (non-streaming) through the SDK-owned loop. */
  generate(prompt: AnyPrompt, opts: ExecutorGenerateOptions<TModel>): Promise<ExecutorGenerateResult<TRawResponse>>

  /**
   * Stream a prompt. Returns the SDK's stream result untouched (`raw`)
   * plus a typed `completion()` resolving with usage/cost/timing metadata.
   * `cascade()` models are rejected — tier evaluation needs full results.
   */
  stream(prompt: AnyPrompt, opts: ExecutorStreamOptions<TModel>): Promise<ExecutorStreamHandle<TRawStream>>

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
// executorAdapter
// ─────────────────────────────────────────────────────────────────

/**
 * Create a loop-owning adapter from an `ExecutorSpec`.
 *
 * Returns a factory `(client: TClient) => CruxExecutor` — the mirror image
 * of `adapter()` for SDKs that run their own tool loop. Implement
 * `AdapterSpec` when your SDK exposes single-turn provider calls; implement
 * `ExecutorSpec` when it drives multi-step generation itself (the Vercel
 * AI SDK's `generateText` with `stopWhen`, for example).
 *
 * Everything above the SDK call is handled here, identically to
 * `adapter()` and backed by the same `adapter/policy/*` modules: prompt
 * resolution, `fallback()`/`router()`/`cascade()` dispatch, validation
 * retry, constraints, guardrails, tool approvals, instrumentation,
 * timeouts, middleware, observability, memory capture, and the agent
 * compositions (`parallel`/`pipeline`/`consensus`/`swarm`).
 *
 * @param spec - The executor specification. See {@link ExecutorSpec}.
 * @returns A factory that binds the spec to a client.
 *
 * @example
 * ```ts
 * import { executorAdapter, fakeExecutor } from '@use-crux/core/adapter'
 *
 * const fake = fakeExecutor({ loops: [[{ text: 'hello' }]] })
 * const executor = executorAdapter(fake.spec)(fake.client)
 *
 * const result = await executor.generate(myPrompt, {
 *   model: 'fake:m-1',
 *   input: { instruction: 'Say hello' },
 *   validationRetry: { maxRetries: 2 },
 *   timeoutMs: 30_000,
 * })
 * ```
 */
export function executorAdapter<TClient, TModel, TRawResponse = unknown, TRawStream = unknown>(
  spec: ExecutorSpec<TClient, TModel, TRawResponse, TRawStream>,
): (client: TClient) => CruxExecutor<TClient, TModel, TRawResponse, TRawStream> {
  return (client: TClient): CruxExecutor<TClient, TModel, TRawResponse, TRawStream> => {
    type GenerateResult = ExecutorGenerateResult<TRawResponse>
    const execution = createAdapterExecution(sdkLoopDialect(spec, client))

    const modelLabel = (model: TModel): string => {
      const info = spec.describeModel(model)
      return info.modelId || info.provider
    }

    // ── generate() ──────────────────────────────────────────────

    async function generate(prompt: AnyPrompt, opts: ExecutorGenerateOptions<TModel>): Promise<GenerateResult> {
      const runWithModel = (model: TModel): Promise<GenerateResult> => generateSingle(prompt, opts, model)

      const dispatch = (model: TModel | FallbackModel<TModel>): Promise<GenerateResult> =>
        isFallback(model) ? executeFallbackLoop(model, runWithModel, modelLabel) : runWithModel(model)

      if (isRouter(opts.model) || isCascade(opts.model)) {
        return resolveModel<TModel | FallbackModel<TModel>, GenerateResult>(
          opts.model as TModel | FallbackModel<TModel>,
          opts.input ?? {},
          dispatch,
          (model) => (isFallback(model) ? 'fallback' : modelLabel(model)),
        )
      }
      if (isFallback(opts.model)) {
        return executeFallbackLoop(opts.model, runWithModel, modelLabel)
      }
      return runWithModel(opts.model as TModel)
    }

    async function generateSingle(
      prompt: AnyPrompt,
      opts: ExecutorGenerateOptions<TModel>,
      model: TModel,
    ): Promise<GenerateResult> {
      return (await execution.generate({
        prompt,
        model,
        input: opts.input,
        tools: opts.tools,
        toolMiddleware: opts.toolMiddleware,
        messages: opts.messages,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        tokenBudget: opts.tokenBudget,
        timeoutMs: opts.timeoutMs,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
        observer: opts.observer,
        activeTools: opts.activeTools,
        extra: opts.extra,
      })) as GenerateResult
    }

    // ── stream() ────────────────────────────────────────────────

    async function streamFn(
      prompt: AnyPrompt,
      opts: ExecutorStreamOptions<TModel>,
    ): Promise<ExecutorStreamHandle<TRawStream>> {
      if (isCascade(opts.model)) {
        throw new Error(
          'cascade() does not support stream(). Use generate() instead — cascade needs full results for tier evaluation.',
        )
      }

      const runWithModel = (model: TModel): Promise<ExecutorStreamHandle<TRawStream>> =>
        streamSingle(prompt, opts, model)

      if (isRouter(opts.model)) {
        return resolveModel<TModel | FallbackModel<TModel>, ExecutorStreamHandle<TRawStream>>(
          opts.model as TModel | FallbackModel<TModel>,
          opts.input ?? {},
          (model) => (isFallback(model) ? executeFallbackLoop(model, runWithModel, modelLabel) : runWithModel(model)),
          (model) => (isFallback(model) ? 'fallback' : modelLabel(model)),
        )
      }
      if (isFallback(opts.model)) {
        return executeFallbackLoop(opts.model, runWithModel, modelLabel)
      }
      return runWithModel(opts.model as TModel)
    }

    async function streamSingle(
      prompt: AnyPrompt,
      opts: ExecutorStreamOptions<TModel>,
      model: TModel,
    ): Promise<ExecutorStreamHandle<TRawStream>> {
      return (await execution.stream({
        prompt,
        model,
        input: opts.input,
        tools: opts.tools,
        toolMiddleware: opts.toolMiddleware,
        messages: opts.messages,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        tokenBudget: opts.tokenBudget,
        timeoutMs: opts.timeoutMs,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
        observer: opts.observer,
        activeTools: opts.activeTools,
        extra: opts.extra,
      })) as ExecutorStreamHandle<TRawStream>
    }

    // ── Agent executor + compositions ───────────────────────────

    const agentExecutor: AgentExecutor = async (agent, options) => {
      const model = (agent.model ?? options.model) as TModel
      const start = Date.now()

      const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) }
      const generateOpts: ExecutorGenerateOptions<TModel> = {
        model,
        input: options.input as Record<string, unknown>,
        maxSteps: options.maxSteps,
        validationRetry: options.validationRetry,
        ...(Object.keys(mergedTools).length > 0 ? { tools: mergedTools } : {}),
      }

      const result = await generate(agent.prompt, generateOpts)

      return {
        agentId: agent.id,
        output: result.object ?? result.text,
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

    const compositions = createCompositions(agentExecutor)

    return Object.freeze({
      executorId: spec.executorId,
      generate,
      stream: streamFn,
      parallel: compositions.parallel,
      pipeline: compositions.pipeline,
      consensus: compositions.consensus,
      swarm: compositions.swarm,
    })
  }
}
