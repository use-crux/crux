/**
 * `executorAdapter()` — factory for loop-owning adapters.
 *
 * The counterpart of `adapter()` for SDKs that drive their own multi-step
 * tool loop (e.g. the Vercel AI SDK). Accepts an `ExecutorSpec` and returns
 * a factory `(client: TClient) => CruxExecutor`.
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

import type { z } from 'zod'
import type { AnyPrompt, GenerationSettings, ResolvedPrompt, TraceMeta, MiddlewareResult } from '../types'
import type { Message } from '../messages'
import type { ExecutorSpec } from './executor-spec'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
  StepDirective,
  StepObserver,
} from './executor-types'
import type { ToolModelOutput } from '../types/tool'
import { validateStructuredOutput, formatValidationFeedback } from './policy/validation-retry'
import { instrumentToolSet, createToolModelOutput, normalizeToolInput, renderToolModelOutput } from './policy/instrument-tools'
import {
  createApprovalId,
  createApprovalRequestMessage,
  createApprovalToken,
  createSyntheticToolCallResponse,
  findApprovedOrDeniedToolCalls,
  findValidApprovalDecision,
} from './policy/approval'
import type { ApprovalRequestInfo } from './policy/approval'
import { readSkillState, captureMemoryTurn } from './policy/resolved'
import { ValidationExhaustedError } from '../validation-retry'
import type { ValidationRetryOptions } from '../validation-retry'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import { createSafety } from '../safety/session'
import type { Safety } from '../safety/session'
import { orchestrateGenerate, orchestrateStream, executeFallbackLoop } from '../orchestrate'
import { isFallback } from '../fallback'
import type { FallbackModel } from '../fallback'
import { isRouter, isCascade } from '../routing'
import { resolveModel } from '../routing/resolve'
import type { AnyRouterModel, CascadeModel } from '../routing'
import { getRuntime } from '../runtime'
import { LOAD_SKILL_TOOL_NAME } from '../skill/tools'
import { applyToolMiddleware, notifyToolApprovalResponses, findToolApprovalRequests, deniedToolModelOutput } from '../tool-middleware'
import type { ToolMiddleware } from '../tool-middleware'
import { createCompositions } from '../agent/create-compositions'
import type { AgentExecutor } from '../agent/executor'

/** Loosely-typed resolve options at the adapter boundary (see `define-adapter.ts`). */
type ExecutorResolveOpts = Parameters<AnyPrompt['resolve']>[0]

/** Default maximum loop steps, matching `adapter()`. */
const DEFAULT_MAX_STEPS = 10

// ─────────────────────────────────────────────────────────────────
// Options & results
// ─────────────────────────────────────────────────────────────────

/**
 * The model argument accepted by executor `generate()`/`stream()`: a plain
 * SDK model or any core routing wrapper around one. Routing is resolved by
 * the factory; the spec only ever receives a plain `TModel`.
 */
export type ExecutorModelArg<TModel> =
  | TModel
  | FallbackModel<TModel>
  | AnyRouterModel<TModel>
  | CascadeModel<TModel>

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
// Internal helpers
// ─────────────────────────────────────────────────────────────────

interface ToolLikeShape {
  execute?: (input: unknown, options: { toolCallId?: string; messages?: readonly unknown[] }) => unknown
  toModelOutput?: (args: {
    toolCallId: string
    input: Record<string, unknown>
    output: unknown
  }) => ToolModelOutput | Promise<ToolModelOutput>
}

function prepareExecutorTools(
  resolved: ResolvedPrompt,
  callTools: Record<string, unknown> | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): Record<string, unknown> | undefined {
  const merged = { ...(resolved.tools ?? {}), ...(callTools ?? {}) }
  if (Object.keys(merged).length === 0) return undefined
  const middleware = normalizeToolMiddleware(resolved.toolMiddleware, callMiddleware)
  return instrumentToolSet(applyToolMiddleware(merged, middleware))
}

function normalizeToolMiddleware(
  promptMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): readonly ToolMiddleware[] | undefined {
  const normalized = [
    ...(Array.isArray(promptMiddleware) ? promptMiddleware : promptMiddleware ? [promptMiddleware] : []),
    ...(Array.isArray(callMiddleware) ? callMiddleware : callMiddleware ? [callMiddleware] : []),
  ]
  return normalized.length > 0 ? normalized : undefined
}

/** Append a canonical tool round (assistant tool calls + tool results). */
function appendToolRoundMessages(
  messages: readonly Message[],
  response: { text: string; toolCalls: Array<{ id: string; name: string; args: unknown }> | undefined },
  results: ReadonlyArray<{ toolCallId: string; name: string; content: string }>,
): Message[] {
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.text,
      ...(response.toolCalls ? { metadata: { toolCalls: response.toolCalls } } : {}),
    },
    ...results.map((result) => ({
      role: 'tool' as const,
      content: result.content,
      metadata: { toolCallId: result.toolCallId, toolName: result.name },
    })),
  ]
}

/**
 * Execute tool calls that were decided (approved or denied) while the loop
 * was suspended. Approved calls run for real; denied calls produce an
 * execution-denied model output, so the model learns the tool was refused.
 */
async function executeResumedToolCalls(
  toolCalls: Array<{ id: string; name: string; args: unknown }>,
  tools: Record<string, unknown> | undefined,
  messages: Message[],
): Promise<Array<{ toolCallId: string; name: string; content: string }>> {
  const requests = findToolApprovalRequests(messages)
  const results: Array<{ toolCallId: string; name: string; content: string }> = []

  for (const toolCall of toolCalls) {
    const request = requests.find((candidate) => candidate.toolCallId === toolCall.id)
    const decision = findValidApprovalDecision(messages, request)

    if (decision && !decision.approved) {
      const modelOutput = deniedToolModelOutput(decision.reason)
      results.push({ toolCallId: toolCall.id, name: toolCall.name, content: renderToolModelOutput(modelOutput) })
      continue
    }

    const tool = tools?.[toolCall.name] as ToolLikeShape | undefined
    try {
      const output = tool?.execute
        ? await tool.execute(toolCall.args, { toolCallId: toolCall.id, messages })
        : undefined
      const modelOutput = tool
        ? await createToolModelOutput({
            tool,
            toolCallId: toolCall.id,
            input: normalizeToolInput(toolCall.args),
            output,
          })
        : ({ type: 'error-json', value: { error: `Tool "${toolCall.name}" not found` } } as const)
      results.push({ toolCallId: toolCall.id, name: toolCall.name, content: renderToolModelOutput(modelOutput) })
    } catch (error) {
      const modelOutput: ToolModelOutput = {
        type: 'error-json',
        value: { error: error instanceof Error ? error.message : String(error) },
      }
      results.push({ toolCallId: toolCall.id, name: toolCall.name, content: renderToolModelOutput(modelOutput) })
    }
  }

  return results
}

/**
 * Merge the factory's steering directive with the caller's. `stop` wins
 * over `amend` wins over `continue`; when both amend, caller fields
 * override factory fields, and `refundStep` is sticky if either set it.
 */
function mergeDirectives(factory: StepDirective, caller: StepDirective | undefined): StepDirective {
  if (!caller) return factory
  if (caller.kind === 'stop') return caller
  if (factory.kind === 'stop') return factory
  if (factory.kind === 'amend' && caller.kind === 'amend') {
    return {
      kind: 'amend',
      system: caller.system ?? factory.system,
      systemBlocks: caller.systemBlocks ?? factory.systemBlocks,
      tools: caller.tools ?? factory.tools,
      activeTools: caller.activeTools ?? factory.activeTools,
      refundStep: Boolean(caller.refundStep || factory.refundStep),
    }
  }
  return caller.kind === 'amend' ? caller : factory
}

/**
 * Compute devtools inspect data (`_inspect` on prepared args) for the
 * middleware/devtools pipeline: context composition, dropped contexts,
 * and the merged tool names. Inspection failures never block generation.
 */
async function inspectForDevtools(
  prompt: AnyPrompt,
  resolveOpts: ExecutorResolveOpts,
  tools: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  try {
    const inspectResult = await prompt.inspect(resolveOpts as Parameters<AnyPrompt['inspect']>[0])
    if (tools) {
      const allToolNames = Object.keys(tools)
      if (allToolNames.length > 0) inspectResult.tools = allToolNames
    }
    return { _inspect: inspectResult }
  } catch {
    return {}
  }
}

function createTimeoutSignal(timeoutMs: number | undefined): { signal: AbortSignal | undefined; dispose: () => void } {
  if (!timeoutMs || timeoutMs <= 0) return { signal: undefined, dispose: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException(`Generation timed out after ${timeoutMs}ms`, 'AbortError')), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

function buildTraceMeta(args: {
  response: { text: string } & Pick<
    import('./types').AdapterResponse,
    'usage' | 'finishReason' | 'toolCalls' | 'responseId' | 'actualModelId'
  >
  costUsd?: number
}): TraceMeta {
  return {
    usage: {
      inputTokens: args.response.usage.inputTokens,
      outputTokens: args.response.usage.outputTokens,
      totalTokens: args.response.usage.totalTokens,
      cacheReadTokens: args.response.usage.cacheReadTokens,
      cacheWriteTokens: args.response.usage.cacheWriteTokens,
      reasoningTokens: args.response.usage.reasoningTokens,
    },
    ...(args.costUsd !== undefined ? { cost: args.costUsd } : {}),
    finishReason: args.response.finishReason,
    toolCalls: args.response.toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    responseId: args.response.responseId,
    actualModelId: args.response.actualModelId,
  }
}

/** Regenerate callback for paths that can never retry (suspension). */
const unreachableRegenerate = (): Promise<never> => {
  throw new Error('regenerate is unreachable for suspended results')
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
 * import { executorAdapter, fakeExecutor } from '@crux/core/adapter'
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
      const modelInfo = spec.describeModel(model)
      const resolveOpts: ExecutorResolveOpts = {
        input: opts.input,
        provider: modelInfo.provider,
        modelId: modelInfo.modelId,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as ExecutorResolveOpts

      const resolved = await prompt.resolve(resolveOpts)
      const mappedSettings = spec.mapSettings(resolved.settings, modelInfo)
      const skillState = readSkillState(resolved)

      // Tool preparation: merge, middleware-wrap, instrument.
      let currentTools = prepareExecutorTools(resolved, opts.tools, opts.toolMiddleware)
      await notifyToolApprovalResponses(currentTools, opts.messages)

      // Initial canonical history.
      let messages: Message[] = [...(opts.messages ?? [])]
      let promptText: string | undefined
      if (messages.length === 0 && resolved.prompt) {
        promptText = resolved.prompt
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // Resume: execute approved/denied tool calls before re-entering the loop.
      const resumedToolCalls = findApprovedOrDeniedToolCalls(messages)
      if (resumedToolCalls.length > 0) {
        const resumedResults = await executeResumedToolCalls(resumedToolCalls, currentTools, messages)
        messages = appendToolRoundMessages(messages, createSyntheticToolCallResponse(resumedToolCalls), resumedResults)
      }

      // Mutable steering state, shared with the loop observer.
      let currentSystem = resolved.system
      let currentSystemBlocks = resolved.systemBlocks

      const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
      const retryId = opts.validationRetry ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : ''

      // Safety session — owns scope merging, phase ordering, the constraint
      // retry machine, suspension policy, audits, and hook emission.
      const safety: Safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: modelInfo.modelId,
        traceId: retryId || undefined,
        systemPrompt: resolved.system,
      })

      /** Factory steering: LoadSkill re-resolution, then the caller's observer. */
      const loopObserver: StepObserver = {
        onStepFinish: async (step) => {
          let factoryDirective: StepDirective = { kind: 'continue' }

          if (skillState && step.toolCalls.some((tc) => tc.name === LOAD_SKILL_TOOL_NAME)) {
            const hooks = getRuntime().instrumentationHooks
            for (const tc of step.toolCalls) {
              const skillId = (tc.args as Record<string, unknown> | undefined)?.name as string | undefined
              if (tc.name === LOAD_SKILL_TOOL_NAME && skillId && skillState.active.has(skillId)) {
                hooks?.onSkillLoad?.({ skillId, source: 'inline' })
              }
            }

            const reResolved = await prompt.resolve(resolveOpts)
            let updatedSystem = reResolved.system ?? ''
            for (const skillId of skillState.active) {
              const loadedSkill = skillState.available.get(skillId)
              if (loadedSkill) {
                updatedSystem += `\n\n## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`
                hooks?.onSkillResolve?.({ skillId })
              }
            }

            const reTools = prepareExecutorTools(reResolved, opts.tools, opts.toolMiddleware)
            await notifyToolApprovalResponses(reTools, opts.messages)

            currentSystem = updatedSystem
            currentSystemBlocks = reResolved.systemBlocks
            currentTools = reTools

            factoryDirective = {
              kind: 'amend',
              system: updatedSystem,
              systemBlocks: reResolved.systemBlocks,
              tools: reTools,
              refundStep: true,
            }
          }

          const callerDirective = await opts.observer?.onStepFinish(step)
          return mergeDirectives(factoryDirective, callerDirective)
        },
      }

      const buildRequest = (signal: AbortSignal | undefined): ExecutorRequest<TModel> => ({
        model,
        modelInfo,
        system: currentSystem,
        systemBlocks: currentSystemBlocks,
        prompt: promptText,
        messages,
        settings: mappedSettings,
        tools: currentTools,
        activeTools: opts.activeTools,
        maxSteps,
        observer: loopObserver,
        abortSignal: signal,
        extra: opts.extra,
      })

      const generated = await orchestrateGenerate<Record<string, unknown>, GenerateResult>(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as NonNullable<typeof prompt.config>),
          preparedArgs: {
            model: modelInfo.modelId,
            system: currentSystem,
            systemBlocks: currentSystemBlocks,
            prompt: promptText,
            messages,
            settings: mappedSettings,
            schema: resolved.schema,
            tools: currentTools,
            input: opts.input ?? {},
            ...(await inspectForDevtools(prompt, resolveOpts, currentTools)),
          },
          model,
          input: opts.input ?? {},
          provider: modelInfo.provider || spec.executorId,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
          timeoutMs: opts.timeoutMs,
        },
        async () => {
          const { signal, dispose } = createTimeoutSignal(opts.timeoutMs)
          try {
            // ── Input guardrails (before first provider call) ──
            const guardedInput = await safety.guardInput({ messages, prompt: promptText })
            messages = [...guardedInput.messages]
            promptText = guardedInput.prompt

            const result = resolved.schema
              ? await generateStructured(buildRequest(signal), resolved.schema)
              : await generateLoop(buildRequest(signal))

            // Output safety (constraints then output guards, suspension
            // policy) ran inside the loop paths — stamp the audits.
            result._meta = safety.stamp(result._meta)

            return result
          } finally {
            dispose()
          }
        },
      )

      await captureMemoryTurn(resolved, {
        promptId: prompt.id,
        input: opts.input ?? {},
        messages: generated.messages,
        assistantText: generated.text,
        toolCalls: generated._meta.toolCalls,
      })

      return generated

      // ── Text + tools path ─────────────────────────────────────

      async function generateLoop(request: ExecutorRequest<TModel>): Promise<GenerateResult> {
        const outcome = await spec.runLoop(client, request)

        if (outcome.status === 'suspended') {
          const result = buildSuspendedResult(outcome)
          // Suspension policy is the session's call — output safety is
          // skipped, and the transcript records the suspension.
          await safety.finalizeOutput({ text: result.text }, unreachableRegenerate, {
            suspended: true,
            messages: result.messages,
          })
          return result
        }

        let steps = outcome.steps
        let finalText = outcome.response.text
        let resultMessages = [...outcome.messages]

        // ── Output safety: constraints then output guards ──
        const finalOutput = await safety.finalizeOutput(
          { text: finalText, parsed: undefined },
          async (corrective) => {
            // The only dialect-specific concern: how to re-call the model.
            const regenMessages: Message[] = [...resultMessages, ...corrective]
            const regen = await spec.runLoop(client, {
              ...request,
              prompt: undefined,
              messages: regenMessages,
              maxSteps: 1,
              observer: undefined,
            })
            steps++
            if (regen.status === 'complete') {
              finalText = regen.response.text
              resultMessages = [...regen.messages]
              return { text: regen.response.text, parsed: undefined }
            }
            return { text: finalText, parsed: undefined }
          },
          { messages: resultMessages },
        )
        if (finalOutput.text !== finalText) finalText = finalOutput.text

        return {
          raw: outcome.raw,
          text: finalText,
          _meta: buildTraceMeta({
            response: { ...outcome.response, text: finalText },
            costUsd: outcome.meta.costUsd,
          }),
          steps,
          messages: resultMessages,
        }
      }

      function buildSuspendedResult(outcome: Extract<ExecutorOutcome<TRawResponse>, { status: 'suspended' }>): GenerateResult {
        const approvals: ApprovalRequestInfo[] = outcome.pendingApprovals.map((pending) => ({
          approvalId: createApprovalId(pending.toolCallId),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          input: pending.input,
          approvalToken: createApprovalToken(),
        }))

        let suspendedMessages = [...outcome.messages]
        for (const approval of approvals) {
          suspendedMessages = [...suspendedMessages, createApprovalRequestMessage(outcome.assistantResponse, approval)]
        }

        return {
          raw: undefined,
          text: outcome.assistantResponse.text,
          _meta: buildTraceMeta({
            response: { ...outcome.assistantResponse, finishReason: 'tool_approval_required' },
          }),
          steps: outcome.steps,
          messages: suspendedMessages,
          pendingApprovals: approvals,
        }
      }

      // ── Structured output path ────────────────────────────────

      async function generateStructured(request: ExecutorRequest<TModel>, schema: z.ZodType): Promise<GenerateResult> {
        const validationRetry = opts.validationRetry
        const maxRetries = validationRetry?.maxRetries ?? 0
        let attempts = 0
        let currentMessages = request.messages ? [...request.messages] : []
        let currentPrompt = request.prompt

        for (;;) {
          const attempt = await spec.attemptStructured(client, {
            ...request,
            prompt: currentPrompt,
            messages: currentMessages,
            schema,
          })

          if (attempt.status === 'ok') {
            let steps = 1 + attempts
            let finalText = attempt.response.text
            let finalObject = attempt.object

            // ── Output safety: constraints then output guards ──
            const finalOutput = await safety.finalizeOutput(
              { text: finalText, parsed: finalObject },
              async (corrective) => {
                // The only dialect-specific concern: how to re-call the model.
                const regenMessages = appendCorrectiveMessages(currentPrompt, currentMessages, finalText, corrective)
                currentPrompt = undefined
                currentMessages = regenMessages
                const regen = await spec.attemptStructured(client, {
                  ...request,
                  prompt: undefined,
                  messages: regenMessages,
                  schema,
                })
                steps++
                if (regen.status === 'ok') {
                  finalText = regen.response.text
                  finalObject = regen.object
                  return { text: regen.response.text, parsed: regen.object }
                }
                return { text: regen.rawText, parsed: undefined }
              },
              { messages: currentMessages },
            )
            if (finalOutput.text !== finalText) finalText = finalOutput.text

            const resultMessages: Message[] = [
              ...(currentMessages.length > 0
                ? currentMessages
                : currentPrompt
                  ? [{ role: 'user' as const, content: currentPrompt }]
                  : []),
              { role: 'assistant' as const, content: finalText },
            ]

            return {
              raw: attempt.raw,
              text: finalText,
              object: finalObject,
              _meta: buildTraceMeta({ response: { ...attempt.response, text: finalText } }),
              steps,
              messages: resultMessages,
            }
          }

          // attempt.status === 'invalid'
          if (attempts < maxRetries) {
            attempts++
            validationRetry?.onRetry?.(attempts, attempt.error)
            getRuntime().instrumentationHooks?.onValidationRetryAttempt?.({
              retryId,
              attemptNumber: attempts,
              maxAttempts: maxRetries,
              error: attempt.error.message,
              rawOutput: attempt.rawText.slice(0, 500),
              repairAttempted: true,
              repairSucceeded: false,
            })
            currentMessages = appendCorrectiveExchange(
              currentPrompt,
              currentMessages,
              attempt.rawText,
              formatValidationFeedback(attempt.rawText, attempt.error),
            )
            currentPrompt = undefined
            continue
          }

          getRuntime().instrumentationHooks?.onValidationRetryExhausted?.({
            retryId,
            totalAttempts: attempts,
            lastError: attempt.error.message,
            promptId: prompt.id ?? 'unknown',
          })
          validationRetry?.onExhausted?.(attempts, attempt.error)
          throw new ValidationExhaustedError({
            lastRawOutput: attempt.rawText,
            zodErrors: attempt.error,
            attempts,
            maxAttempts: maxRetries,
            promptId: prompt.id ?? 'unknown',
          })
        }
      }
    }

    /** Convert a prompt-or-messages request into messages carrying a corrective exchange. */
    function appendCorrectiveExchange(
      promptText: string | undefined,
      messages: readonly Message[],
      failedOutput: string,
      feedback: string,
    ): Message[] {
      return appendCorrectiveMessages(promptText, messages, failedOutput, [{ role: 'user', content: feedback }])
    }

    /** As {@link appendCorrectiveExchange}, but with pre-built corrective messages from the safety session. */
    function appendCorrectiveMessages(
      promptText: string | undefined,
      messages: readonly Message[],
      failedOutput: string,
      corrective: readonly Message[],
    ): Message[] {
      const base: Message[] =
        messages.length > 0 ? [...messages] : promptText ? [{ role: 'user', content: promptText }] : []
      return [...base, { role: 'assistant', content: failedOutput || 'Invalid output' }, ...corrective]
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
      const modelInfo = spec.describeModel(model)
      const resolveOpts: ExecutorResolveOpts = {
        input: opts.input,
        provider: modelInfo.provider,
        modelId: modelInfo.modelId,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as ExecutorResolveOpts

      const resolved = await prompt.resolve(resolveOpts)
      const mappedSettings = spec.mapSettings(resolved.settings, modelInfo)
      const tools = prepareExecutorTools(resolved, opts.tools, opts.toolMiddleware)
      await notifyToolApprovalResponses(tools, opts.messages)

      let messages: Message[] = [...(opts.messages ?? [])]
      let promptText: string | undefined
      if (messages.length === 0 && resolved.prompt) {
        promptText = resolved.prompt
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // Safety session — input guards run before the provider call; the
      // spec drives the streaming sub-protocol over outgoing text deltas.
      const safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: modelInfo.modelId,
        systemPrompt: resolved.system,
      })
      const guardedInput = await safety.guardInput({ messages, prompt: promptText })
      messages = [...guardedInput.messages]
      promptText = guardedInput.prompt

      const { signal, dispose } = createTimeoutSignal(opts.timeoutMs)

      const request: ExecutorRequest<TModel> & { schema?: z.ZodType } = {
        model,
        modelInfo,
        system: resolved.system,
        systemBlocks: resolved.systemBlocks,
        prompt: promptText,
        messages,
        settings: mappedSettings,
        tools,
        activeTools: opts.activeTools,
        maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
        observer: opts.observer,
        abortSignal: signal,
        extra: opts.extra,
        // Structured streams (streamObject) have no text-delta surface to
        // guard; the streaming sub-protocol applies to text streams only.
        ...(safety.enabled && !resolved.schema ? { safety: safety.openStream() } : {}),
        ...(resolved.schema ? { schema: resolved.schema } : {}),
      }

      const handle = await orchestrateStream<Record<string, unknown>, ExecutorStreamHandle<TRawStream>>(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as NonNullable<typeof prompt.config>),
          preparedArgs: {
            model: modelInfo.modelId,
            system: resolved.system,
            systemBlocks: resolved.systemBlocks,
            prompt: promptText,
            messages,
            settings: mappedSettings,
            schema: resolved.schema,
            tools,
            input: opts.input ?? {},
            ...(await inspectForDevtools(prompt, resolveOpts, tools)),
          },
          input: opts.input ?? {},
          provider: modelInfo.provider || spec.executorId,
          model,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
          timeoutMs: opts.timeoutMs,
          ...(spec.replayStream
            ? {
                createCachedStreamResult: (cached: { text?: string; object?: unknown; meta?: Record<string, unknown> }) =>
                  spec.replayStream!(cached) as unknown as MiddlewareResult,
              }
            : {}),
        },
        async () => spec.runStream(client, request),
      )

      let memoryCaptured = false
      const innerCompletion = handle.completion.bind(handle)
      const wrappedCompletion = async (): Promise<ExecutorStreamMeta | undefined> => {
        try {
          const meta = await innerCompletion()
          const stamped = meta ? safety.stamp(meta) : meta
          if (!memoryCaptured) {
            memoryCaptured = true
            await captureMemoryTurn(resolved, {
              promptId: prompt.id,
              input: opts.input ?? {},
              messages,
              assistantText: stamped?.text,
              toolCalls: stamped?.toolCalls,
            })
          }
          return stamped
        } finally {
          dispose()
        }
      }

      return { ...handle, completion: wrappedCompletion }
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
