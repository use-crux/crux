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

import { z } from 'zod'
import type { Prompt, ResolvedPrompt, GenerationSettings, TraceMeta, AnyPrompt, MiddlewareResult } from '../types'

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
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from './types'
import type { ToolModelOutput } from '../types/tool'
import { resolvePrompt, resolveStringOrFn, mergeInputSchemas } from '../resolve'
import { validateStructuredOutput, formatValidationFeedback } from './policy/validation-retry'
import {
  createToolModelOutput,
  emitToolArgsArtifact,
  emitToolResultArtifact,
  measureModelOutput,
  measureUnknown,
  normalizeToolInput,
  openToolCallSpan,
  renderToolModelOutput,
  toJsonValue,
} from './policy/instrument-tools'
import {
  createApprovalId,
  createApprovalRequestMessage,
  createApprovalToken,
  createSyntheticToolCallResponse,
  emitToolApprovalObservation,
  findApprovedOrDeniedToolCalls,
  findValidApprovalDecision,
} from './policy/approval'
import type { ApprovalRequestInfo } from './policy/approval'
import { readSkillState, captureMemoryTurn } from './policy/resolved'
import { LOAD_SKILL_TOOL_NAME } from '../skill/tools'
import { createCompositions } from '../agent/create-compositions'
import { getRuntime } from '../runtime'
import { getExecutionContext } from '../execution-context'
import type { AgentExecutor, AgentResult } from '../agent/executor'
import { ValidationExhaustedError } from '../validation-retry'
import type { ValidationRetryOptions } from '../validation-retry'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import { createSafety } from '../safety/session'
import { orchestrateGenerate, orchestrateStream } from '../orchestrate'
import { observe } from '../observability'
import { applyToolMiddleware } from '../tool-middleware'
import type { ToolMiddleware } from '../tool-middleware'
import {
  deniedToolModelOutput,
  findToolApprovalDecision,
  findToolApprovalRequests,
  notifyToolApprovalResponses,
} from '../tool-middleware'

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
// Internal: Convert resolved prompt tools to canonical tool array
// ─────────────────────────────────────────────────────────────────

/**
 * Convert the resolved prompt's tool map to the canonical tool array format.
 * Applies optional schema sanitization from the adapter spec.
 */
function convertTools(
  resolvedTools: Record<string, unknown> | undefined,
  sanitizeToolSchema?: (schema: Record<string, unknown>) => Record<string, unknown>,
): CallArgs['tools'] {
  if (!resolvedTools || Object.keys(resolvedTools).length === 0) return undefined

  return Object.entries(resolvedTools).map(([name, tool]) => {
    const t = tool as {
      description?: string
      parameters?: unknown
      execute?: (
        args: unknown,
        options?: { readonly toolCallId?: string; readonly messages?: readonly unknown[] },
      ) => unknown | Promise<unknown>
      needsApproval?:
        | boolean
        | ((args: unknown, options: { toolCallId?: string; messages?: Message[] }) => boolean | PromiseLike<boolean>)
      toModelOutput?: (args: {
        toolCallId: string
        input: Record<string, unknown>
        output: unknown
      }) => ToolModelOutput | Promise<ToolModelOutput>
    }

    // Convert Zod schema to JSON Schema if present
    let parameters: Record<string, unknown> = {}
    if (t.parameters && typeof t.parameters === 'object' && '_zod' in (t.parameters as object)) {
      // Zod v4 schema -- use z.toJSONSchema()
      try {
        parameters = z.toJSONSchema(t.parameters as z.ZodType) as Record<string, unknown>
      } catch {
        parameters = {}
      }
    } else if (t.parameters && typeof t.parameters === 'object') {
      parameters = t.parameters as Record<string, unknown>
    }

    // Apply provider-specific schema sanitization
    if (sanitizeToolSchema) {
      parameters = sanitizeToolSchema(parameters)
    }

    return {
      name,
      description: t.description ?? '',
      parameters,
      execute: t.execute ?? (() => undefined),
      needsApproval: t.needsApproval,
      toModelOutput: t.toModelOutput,
    }
  })
}

type ExecutableTool = NonNullable<CallArgs['tools']>[number]
type PreparedTools = {
  readonly tools: CallArgs['tools']
  readonly wrappedTools: Record<string, unknown>
}
type ToolExecutionResult =
  | { readonly status: 'executed'; readonly results: ToolResultEntry[] }
  | {
      readonly status: 'approval-required'
      readonly request: ApprovalRequestInfo
    }

// ─────────────────────────────────────────────────────────────────
// Internal: Execute tools from a response
// ─────────────────────────────────────────────────────────────────

/**
 * Execute all tool calls from an adapter response.
 * Returns an array of tool result entries.
 */
async function executeToolCalls(
  toolCalls: AdapterResponse['toolCalls'],
  toolMap: Map<string, ExecutableTool>,
  messages: Message[],
): Promise<ToolExecutionResult> {
  if (!toolCalls || toolCalls.length === 0) return { status: 'executed', results: [] }

  const results: ToolResultEntry[] = []

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name)
    const hooks = getRuntime().instrumentationHooks
    const traceId = getExecutionContext()?.traceId ?? observe.captureContext()?.traceId
    if (!tool) {
      const startedAt = Date.now()
      const span = openToolCallSpan(tc.name, tc.id, tc.args)
      hooks?.onToolStart?.({ toolCallId: tc.id, toolName: tc.name, args: tc.args, traceId, spanId: span.spanId })
      const modelOutput: ToolModelOutput = {
        type: 'error-json',
        value: { error: `Tool "${tc.name}" not found` },
      }
      const modelOutputSize = measureModelOutput(modelOutput)
      span.withContext(() => {
        emitToolArgsArtifact(span.spanId, tc.name, tc.id, tc.args)
        emitToolResultArtifact(span.spanId, tc.name, tc.id, modelOutput, {
          resultKind: 'model',
          modelOutputType: modelOutput.type,
          modelOutputSize,
          isError: true,
          errorKind: 'tool_not_found',
        })
      })
      hooks?.onToolEnd?.({
        toolCallId: tc.id,
        toolName: tc.name,
        durationMs: Date.now() - startedAt,
        modelOutput,
        modelOutputType: modelOutput.type,
        outputSize: 0,
        modelOutputSize,
        tokenSavingsEstimate: 0,
        error: `Tool "${tc.name}" not found`,
        traceId,
        spanId: span.spanId,
      })
      span.error(new Error(`Tool "${tc.name}" not found`), {
        isError: true,
        phase: 'tool.lookup',
        errorKind: 'tool_not_found',
        outputSize: 0,
        modelOutputSize,
      })
      results.push({
        toolCallId: tc.id,
        name: tc.name,
        modelOutput,
        content: renderToolModelOutput(modelOutput),
        outputSize: 0,
        modelOutputSize,
        isError: true,
      })
      continue
    }

    const approvalId = createApprovalId(tc.id)
    const approvalRequest = findToolApprovalRequests(messages).find((request) => request.approvalId === approvalId)
    let approvalDecision: ReturnType<typeof findToolApprovalDecision>
    try {
      approvalDecision = findValidApprovalDecision(messages, approvalRequest)
    } catch (error) {
      emitToolApprovalObservation('token-mismatch', {
        approvalId,
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.args,
        error,
      })
      throw error
    }
    if (await isApprovalNeeded(tool, tc, messages)) {
      if (!approvalDecision) {
        const request = {
          approvalId,
          toolCallId: tc.id,
          toolName: tc.name,
          input: toJsonValue(tc.args),
          approvalToken: createApprovalToken(),
        }
        hooks?.onToolApprovalRequest?.({
          approvalId,
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
          traceId,
        })
        emitToolApprovalObservation('request', {
          approvalId,
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
        })
        return {
          status: 'approval-required',
          request,
        }
      }

      if (!approvalDecision.approved) {
        const modelOutput = deniedToolModelOutput(approvalDecision.reason)
        const modelOutputSize = measureModelOutput(modelOutput)
        emitToolApprovalObservation('denied', {
          approvalId,
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
          reason: approvalDecision.reason,
          modelOutput,
          modelOutputSize,
        })
        results.push({
          toolCallId: tc.id,
          name: tc.name,
          modelOutput,
          content: renderToolModelOutput(modelOutput),
          outputSize: 0,
          modelOutputSize,
          isError: true,
        })
        continue
      }
      emitToolApprovalObservation('approved', {
        approvalId,
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.args,
      })
    }

    const startedAt = Date.now()
    const span = openToolCallSpan(tc.name, tc.id, tc.args)
    hooks?.onToolStart?.({ toolCallId: tc.id, toolName: tc.name, args: tc.args, traceId, spanId: span.spanId })
    try {
      span.withContext(() => emitToolArgsArtifact(span.spanId, tc.name, tc.id, tc.args))
      const result = await span.withContext(() => tool.execute(tc.args, { toolCallId: tc.id, messages }))
      const modelOutput = await span.withContext(() => {
        return createToolModelOutput({
          tool,
          toolCallId: tc.id,
          input: normalizeToolInput(tc.args),
          output: result,
        })
      })
      const outputSize = measureUnknown(result)
      const modelOutputSize = measureModelOutput(modelOutput)
      const content = renderToolModelOutput(modelOutput)
      span.withContext(() => {
        emitToolResultArtifact(span.spanId, tc.name, tc.id, result, {
          resultKind: 'raw',
          outputSize,
          isError: false,
        })
        emitToolResultArtifact(span.spanId, tc.name, tc.id, modelOutput, {
          resultKind: 'model',
          modelOutputType: modelOutput.type,
          modelOutputSize,
          tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
          isError: false,
        })
      })
      hooks?.onToolEnd?.({
        toolCallId: tc.id,
        toolName: tc.name,
        durationMs: Date.now() - startedAt,
        result,
        modelOutput,
        modelOutputType: modelOutput.type,
        outputSize,
        modelOutputSize,
        tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
        traceId,
        spanId: span.spanId,
      })
      span.end({
        isError: false,
        outputSize,
        modelOutputSize,
        modelOutputType: modelOutput.type,
        tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
      })
      results.push({
        toolCallId: tc.id,
        name: tc.name,
        output: result,
        modelOutput,
        content,
        outputSize,
        modelOutputSize,
      })
    } catch (err) {
      const modelOutput: ToolModelOutput = {
        type: 'error-json',
        value: { error: err instanceof Error ? err.message : String(err) },
      }
      const modelOutputSize = measureModelOutput(modelOutput)
      span.withContext(() => {
        emitToolResultArtifact(span.spanId, tc.name, tc.id, modelOutput, {
          resultKind: 'model',
          modelOutputType: modelOutput.type,
          modelOutputSize,
          tokenSavingsEstimate: 0,
          isError: true,
          errorKind: 'execute_error',
        })
      })
      hooks?.onToolEnd?.({
        toolCallId: tc.id,
        toolName: tc.name,
        durationMs: Date.now() - startedAt,
        modelOutput,
        modelOutputType: modelOutput.type,
        outputSize: 0,
        modelOutputSize,
        tokenSavingsEstimate: 0,
        error: err instanceof Error ? err.message : String(err),
        traceId,
        spanId: span.spanId,
      })
      span.error(err, {
        isError: true,
        phase: 'tool.execute',
        errorKind: 'execute_error',
        outputSize: 0,
        modelOutputSize,
        modelOutputType: modelOutput.type,
        tokenSavingsEstimate: 0,
      })
      results.push({
        toolCallId: tc.id,
        name: tc.name,
        modelOutput,
        content: renderToolModelOutput(modelOutput),
        outputSize: 0,
        modelOutputSize,
        isError: true,
      })
    }
  }

  return { status: 'executed', results }
}

function emitToolRequestArtifacts(toolCalls: NonNullable<AdapterResponse['toolCalls']>): void {
  const spanId = observe.captureContext()?.currentSpanId
  for (const toolCall of toolCalls) {
    const artifactId = observe.artifact({
      kind: 'tool.request',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        args: toJsonValue(toolCall.args),
      },
      attributes: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        inputSize: measureUnknown(toolCall.args),
      },
    })
    if (artifactId && spanId) {
      observe.edge({
        edgeType: 'produced',
        from: { kind: 'span', id: spanId },
        to: { kind: 'artifact', id: artifactId },
        attributes: { toolName: toolCall.name, toolCallId: toolCall.id },
      })
    }
  }
}

async function isApprovalNeeded(
  tool: ExecutableTool,
  toolCall: { id: string; args: unknown },
  messages: Message[],
): Promise<boolean> {
  if (tool.needsApproval === undefined) return false
  if (typeof tool.needsApproval === 'boolean') return tool.needsApproval
  return Boolean(await tool.needsApproval(toolCall.args, { toolCallId: toolCall.id, messages }))
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

function prepareTools(
  resolved: ResolvedPrompt,
  callTools: Record<string, unknown> | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
  sanitizeToolSchema?: (schema: Record<string, unknown>) => Record<string, unknown>,
): PreparedTools {
  const merged = {
    ...(resolved.tools ?? {}),
    ...(callTools ?? {}),
  }
  const middleware = normalizeToolMiddleware(resolved.toolMiddleware, callMiddleware)
  const wrapped = applyToolMiddleware(merged, middleware)
  return {
    tools: convertTools(wrapped, sanitizeToolSchema),
    wrappedTools: wrapped,
  }
}

function appendAssistantResultMessage(messages: Message[], response: AdapterResponse | undefined): Message[] {
  if (!response) return messages
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.text,
      ...(response.toolCalls ? { metadata: { toolCalls: response.toolCalls } } : {}),
    },
  ]
}

// ─────────────────────────────────────────────────────────────────
// adapter
// ─────────────────────────────────────────────────────────────────

/** Default maximum tool loop iterations. */
const DEFAULT_MAX_STEPS = 10

// ─────────────────────────────────────────────────────────────────
// Internal: synthetic text chunks for guarded streams
// ─────────────────────────────────────────────────────────────────

/**
 * When the safety stream rewrites or releases held text, the original
 * provider chunk no longer carries the right delta. The dialect yields a
 * synthetic chunk instead, and wraps `extractTextDelta` to read it.
 */
const SAFETY_TEXT_CHUNK = Symbol('crux.safety.textChunk')

interface SafetyTextChunk {
  readonly [SAFETY_TEXT_CHUNK]: true
  readonly text: string
}

function createSafetyTextChunk(text: string): SafetyTextChunk {
  return { [SAFETY_TEXT_CHUNK]: true, text }
}

function isSafetyTextChunk(chunk: unknown): chunk is SafetyTextChunk {
  return typeof chunk === 'object' && chunk !== null && SAFETY_TEXT_CHUNK in chunk
}

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
    // ── generate() ──────────────────────────────────────────────

    async function generate(
      prompt: AnyPrompt,
      opts: AdapterGenerateOptions<TExtra>,
    ): Promise<AdapterGenerateResult<TRawResponse>> {
      // 1. Resolve the prompt
      const resolveOpts: AdapterResolveOpts = {
        input: opts.input,
        provider: opts.provider ?? spec.providerId,
        modelId: opts.model,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as AdapterResolveOpts

      const resolved = await prompt.resolve(resolveOpts)

      // 2. Map settings
      const mappedSettings = spec.mapSettings(resolved.settings)

      // 3. Convert tools to canonical format
      let preparedTools = prepareTools(resolved, opts.tools, opts.toolMiddleware, spec.sanitizeToolSchema)
      const tools = preparedTools.tools
      await notifyToolApprovalResponses(preparedTools.wrappedTools, opts.messages)

      // Build a lookup map for tool execution
      const toolMap = new Map<string, ExecutableTool>()
      if (tools) {
        for (const tool of tools) {
          toolMap.set(tool.name, tool)
        }
      }

      // 4. Build initial messages
      let messages: Message[] = [...(opts.messages ?? [])]
      if (messages.length === 0 && resolved.prompt) {
        messages.push({ role: 'user', content: resolved.prompt })
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // 5. Build schema params
      let schemaParams: Record<string, unknown> | undefined
      if (resolved.schema && spec.wrapOutputSchema) {
        schemaParams = spec.wrapOutputSchema(resolved.schema)
      }

      // 6. Tool loop (with validation retry)
      const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
      let lastRaw: TRawResponse | undefined
      let lastExtracted: AdapterResponse | undefined
      let steps = 0

      // Validation retry state
      const validationRetry = opts.validationRetry
      const maxValidationRetries = validationRetry?.maxRetries ?? 0
      let validationRetries = 0
      const retryId = validationRetry ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : ''

      // Safety session — owns scope merging, phase ordering, the constraint
      // retry machine, suspension policy, audits, and hook emission.
      const safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: opts.model,
        traceId: retryId || undefined,
        systemPrompt: resolved.system,
      })

      // Track skill state for re-resolution
      let currentSystem = resolved.system
      let currentSystemBlocks = resolved.systemBlocks
      let currentTools = tools
      let currentToolMap = toolMap
      const skillState = readSkillState(resolved)

      const resumedToolCalls = findApprovedOrDeniedToolCalls(messages)
      if (resumedToolCalls.length > 0) {
        const resumedResponse = createSyntheticToolCallResponse(resumedToolCalls)
        const resumedResults = await executeToolCalls(resumedResponse.toolCalls, currentToolMap, messages)
        if (resumedResults.status === 'executed') {
          messages = spec.appendToolRound(messages, resumedResponse, resumedResults.results)
        }
      }

      const generated = await orchestrateGenerate(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as typeof prompt.config),
          preparedArgs: {
            model: opts.model,
            system: currentSystem,
            systemBlocks: currentSystemBlocks,
            messages,
            settings: mappedSettings,
            schema: resolved.schema,
            schemaParams,
            tools: currentTools,
            extra: (opts.extra ?? {}) as TExtra,
            input: opts.input ?? {},
          },
          model: opts.model,
          input: opts.input ?? {},
          provider: spec.providerId,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
        },
        async () => {
          // ── Input guardrails (before first provider call) ──
          messages = [...(await safety.guardInput({ messages })).messages]

          let lastCallArgs: CallArgs<TExtra> | undefined

          for (let step = 0; step < maxSteps; step++) {
            steps++

            const callArgs: CallArgs<TExtra> = {
              model: opts.model,
              system: currentSystem,
              systemBlocks: currentSystemBlocks,
              messages,
              settings: mappedSettings,
              schema: resolved.schema,
              schemaParams,
              tools: currentTools,
              extra: (opts.extra ?? {}) as TExtra,
            }
            lastCallArgs = callArgs

            const { raw, extracted } = await spec.call(client, callArgs)
            lastRaw = raw
            lastExtracted = extracted

            // Check if there are tool calls to process
            if (extracted.toolCalls && extracted.toolCalls.length > 0) {
              // Branch A: Tool calls → execute tools, continue loop (existing behavior)
            } else if (resolved.schema && validationRetry) {
              // Branch B: No tool calls, schema present, validation retry enabled
              const validationResult = validateStructuredOutput(extracted.text, resolved.schema)

              if (validationResult.valid) {
                // Text may have been repaired (e.g., markdown fences stripped)
                const validText = validationResult.repairedText ?? extracted.text
                if (validText !== extracted.text) {
                  lastExtracted = { ...extracted, text: validText }
                }

                break // Valid output — constraints and output guards run post-loop
              }

              // Validation failed — check retry budget
              if (validationRetries < maxValidationRetries && step < maxSteps - 1) {
                validationRetries++
                validationRetry.onRetry?.(validationRetries, validationResult.error!)

                // Emit instrumentation hook
                const hooks = getRuntime().instrumentationHooks
                hooks?.onValidationRetryAttempt?.({
                  retryId,
                  attemptNumber: validationRetries,
                  maxAttempts: maxValidationRetries,
                  error: validationResult.error!.message,
                  rawOutput: extracted.text.slice(0, 500),
                  repairAttempted: validationResult.repairedText !== extracted.text,
                  repairSucceeded: false,
                })

                // Inject corrective feedback as messages
                messages = spec.appendToolRound(messages, extracted, [])
                messages = [
                  ...messages,
                  {
                    role: 'user' as const,
                    content: formatValidationFeedback(extracted.text, validationResult.error!),
                  },
                ]
                continue // Retry — consumes a step
              }

              // Retries exhausted — emit hook before throwing
              const hooks = getRuntime().instrumentationHooks
              hooks?.onValidationRetryExhausted?.({
                retryId,
                totalAttempts: validationRetries,
                lastError: validationResult.error!.message,
                promptId: prompt.id ?? 'unknown',
              })
              validationRetry.onExhausted?.(validationRetries, validationResult.error!)
              throw new ValidationExhaustedError({
                lastRawOutput: extracted.text,
                zodErrors: validationResult.error!,
                attempts: validationRetries,
                maxAttempts: maxValidationRetries,
                promptId: prompt.id ?? 'unknown',
              })
            } else {
              // Branch C: No tool calls, no validation retry — constraints
              // and output guards run post-loop via the safety session.
              break
            }

            // Continue with tool call processing (Branch A)
            if (!extracted.toolCalls || extracted.toolCalls.length === 0) continue
            emitToolRequestArtifacts(extracted.toolCalls)

            // Check for LoadSkill system tool — intercept for re-resolution
            const hasLoadSkill = skillState && extracted.toolCalls.some((tc) => tc.name === LOAD_SKILL_TOOL_NAME)

            // Execute tools (including LoadSkill which marks skills as active)
            const toolExecution = await executeToolCalls(extracted.toolCalls, currentToolMap, messages)
            if (toolExecution.status === 'approval-required') {
              messages = [...messages, createApprovalRequestMessage(extracted, toolExecution.request)]
              lastExtracted = { ...extracted, finishReason: 'tool_approval_required' }
              break
            }
            const toolResults = toolExecution.results

            // If LoadSkill was called, re-resolve the prompt with activated skills in system prompt
            if (hasLoadSkill && skillState) {
              const hooks = getRuntime().instrumentationHooks

              // Emit onSkillLoad for each newly loaded skill
              for (const tc of extracted.toolCalls) {
                const skillId = (tc.args as Record<string, unknown> | undefined)?.name as string | undefined
                if (tc.name === LOAD_SKILL_TOOL_NAME && skillId && skillState.active.has(skillId)) {
                  hooks?.onSkillLoad?.({ skillId, source: 'inline' })
                }
              }

              // Re-resolve the prompt — activated skills now contribute their full instructions
              const reResolved = await prompt.resolve(resolveOpts)

              // Build the updated system prompt with loaded skill instructions appended
              let updatedSystem = reResolved.system ?? ''
              for (const skillId of skillState.active) {
                const loadedSkill = skillState.available.get(skillId)
                if (loadedSkill) {
                  updatedSystem += `\n\n## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`
                  // Emit onSkillResolve after injection
                  hooks?.onSkillResolve?.({ skillId })
                }
              }

              currentSystem = updatedSystem
              currentSystemBlocks = reResolved.systemBlocks

              // Rebuild tools (the re-resolved prompt may have updated skill tools)
              preparedTools = prepareTools(reResolved, opts.tools, opts.toolMiddleware, spec.sanitizeToolSchema)
              currentTools = preparedTools.tools
              await notifyToolApprovalResponses(preparedTools.wrappedTools, opts.messages)
              currentToolMap = new Map<string, ExecutableTool>()
              if (currentTools) {
                for (const tool of currentTools) {
                  currentToolMap.set(tool.name, tool)
                }
              }

              // LoadSkill does NOT count against maxSteps — decrement
              steps--
              step--
            }

            // Append tool round to messages for next iteration
            messages = spec.appendToolRound(messages, extracted, toolResults)
          }

          // ── Output safety: constraints then output guards (after loop) ──
          // The session owns ordering and suspension policy — on
          // tool-approval suspension all output safety is skipped.
          if (lastExtracted) {
            const suspended = lastExtracted.finishReason === 'tool_approval_required'
            let parsed: unknown
            if (resolved.schema && !suspended) {
              try {
                parsed = JSON.parse(lastExtracted.text)
              } catch {
                parsed = undefined
              }
            }
            const finalOutput = await safety.finalizeOutput(
              { text: lastExtracted.text, parsed },
              async (corrective) => {
                // The only dialect-specific concern: how to re-call the model.
                messages = spec.appendToolRound(messages, lastExtracted!, [])
                messages = [...messages, ...corrective]
                const regen = await spec.call(client, { ...lastCallArgs!, messages })
                lastRaw = regen.raw
                lastExtracted = regen.extracted
                steps++
                if (resolved.schema) {
                  // Re-run structural validation on the regenerated output.
                  const reVal = validateStructuredOutput(regen.extracted.text, resolved.schema)
                  const reText = reVal.valid ? (reVal.repairedText ?? regen.extracted.text) : regen.extracted.text
                  if (reText !== regen.extracted.text) {
                    lastExtracted = { ...regen.extracted, text: reText }
                  }
                  let reParsed: unknown
                  try {
                    reParsed = JSON.parse(reText)
                  } catch {
                    reParsed = undefined
                  }
                  return { text: reText, parsed: reParsed }
                }
                return { text: regen.extracted.text, parsed: undefined }
              },
              { suspended, messages },
            )
            if (finalOutput.text !== lastExtracted.text) {
              lastExtracted = { ...lastExtracted, text: finalOutput.text }
            }
          }

          // 7. Build result
          const meta: TraceMeta = safety.stamp({
            usage: lastExtracted
              ? {
                  inputTokens: lastExtracted.usage.inputTokens,
                  outputTokens: lastExtracted.usage.outputTokens,
                  totalTokens: lastExtracted.usage.totalTokens,
                  cacheReadTokens: lastExtracted.usage.cacheReadTokens,
                  cacheWriteTokens: lastExtracted.usage.cacheWriteTokens,
                  reasoningTokens: lastExtracted.usage.reasoningTokens,
                }
              : undefined,
            finishReason: lastExtracted?.finishReason,
            toolCalls: lastExtracted?.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
            responseId: lastExtracted?.responseId,
            actualModelId: lastExtracted?.actualModelId,
          })

          const resultMessages =
            lastExtracted?.finishReason === 'tool_approval_required'
              ? messages
              : appendAssistantResultMessage(messages, lastExtracted)

          return {
            raw: lastRaw!,
            text: lastExtracted?.text ?? '',
            _meta: meta,
            steps,
            messages: resultMessages,
          }
        },
      )

      await captureMemoryTurn(resolved, {
        promptId: prompt.id,
        input: opts.input ?? {},
        messages,
        assistantText: generated.text,
        toolCalls: generated._meta.toolCalls,
      })

      return generated
    }

    // ── stream() ──────────────────────────────────────────────

    async function streamFn(prompt: AnyPrompt, opts: AdapterStreamOptions<TExtra>): Promise<StreamHandle<TRawStream>> {
      // 1. Resolve the prompt
      const resolveOpts: AdapterResolveOpts = {
        input: opts.input,
        provider: opts.provider ?? spec.providerId,
        modelId: opts.model,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as AdapterResolveOpts

      const resolved = await prompt.resolve(resolveOpts)

      // 2. Map settings
      const mappedSettings = spec.mapSettings(resolved.settings)

      // 3. Convert tools
      const tools = prepareTools(resolved, opts.tools, opts.toolMiddleware, spec.sanitizeToolSchema).tools

      // 4. Build messages
      let messages: Message[] = [...(opts.messages ?? [])]
      if (messages.length === 0 && resolved.prompt) {
        messages.push({ role: 'user', content: resolved.prompt })
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // Safety session — input guards run before the provider call; the
      // streaming sub-protocol guards the outgoing text deltas.
      const safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: opts.model,
        systemPrompt: resolved.system,
      })
      messages = [...(await safety.guardInput({ messages })).messages]

      // 5. Build schema params
      let schemaParams: Record<string, unknown> | undefined
      if (resolved.schema && spec.wrapOutputSchema) {
        schemaParams = spec.wrapOutputSchema(resolved.schema)
      }

      // 6. Call spec.stream
      const callArgs: CallArgs<TExtra> = {
        model: opts.model,
        system: resolved.system,
        systemBlocks: resolved.systemBlocks,
        messages,
        settings: mappedSettings,
        schema: resolved.schema,
        schemaParams,
        tools,
        extra: (opts.extra ?? {}) as TExtra,
      }

      const handle = await orchestrateStream(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as typeof prompt.config),
          preparedArgs: { ...callArgs, input: opts.input ?? {} },
          input: opts.input ?? {},
          provider: spec.providerId,
          model: opts.model,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
          createCachedStreamResult: (cached) => createCachedStreamHandle(cached) as unknown as MiddlewareResult,
        },
        async () => spec.stream(client, callArgs),
      )

      // Every dialect stream() drives the session's streaming sub-protocol:
      // feed each text delta, forward emits, swallow holds, surface blocks
      // as stream errors, and seal at end-of-stream.
      const safetyStream = safety.enabled ? safety.openStream() : undefined

      let streamedAssistantText = ''
      async function* trackedRawStream() {
        type Chunk = Awaited<TRawStream extends AsyncIterable<infer T> ? T : never>
        for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
          const delta = handle.extractTextDelta(chunk)
          if (!safetyStream || delta === undefined || delta === '') {
            if (delta) streamedAssistantText += delta
            yield chunk as Chunk
            continue
          }
          const directive = await safetyStream.feed(delta)
          if (directive.kind === 'hold') continue
          streamedAssistantText += directive.content
          if (directive.content === delta) {
            yield chunk as Chunk
          } else if (directive.content.length > 0) {
            yield createSafetyTextChunk(directive.content) as Chunk
          }
        }
        if (safetyStream) {
          const seal = await safetyStream.finish()
          if (seal.pending.length > 0) {
            streamedAssistantText += seal.pending
            yield createSafetyTextChunk(seal.pending) as Chunk
          }
        }
      }

      let memoryCaptured = false
      async function captureStreamMemory(meta: TraceMeta | undefined) {
        if (memoryCaptured) return
        memoryCaptured = true
        await captureMemoryTurn(resolved, {
          promptId: prompt.id,
          input: opts.input ?? {},
          messages,
          assistantText: streamedAssistantText || undefined,
          toolCalls: meta?.toolCalls,
        })
      }

      return {
        ...handle,
        rawStream: trackedRawStream() as unknown as TRawStream & AsyncIterable<unknown>,
        extractTextDelta: (chunk: unknown) =>
          isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk),
        completion: async () => {
          const meta = await handle.completion()
          const stamped = meta ? safety.stamp(meta) : meta
          await captureStreamMemory(stamped)
          return stamped
        },
      }
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

function createCachedStreamHandle(cached: {
  text?: string
  object?: unknown
  meta?: Record<string, unknown>
}): StreamHandle<AsyncIterable<{ text: string }>> {
  const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
  async function* rawStream() {
    for (let index = 0; index < text.length; index += 64) {
      yield { text: text.slice(index, index + 64) }
    }
  }
  return {
    rawStream: rawStream(),
    extractTextDelta: (chunk: unknown) => (chunk as { text?: string }).text,
    completion: async () => {
      const meta = (cached.meta ?? {}) as TraceMeta
      const semanticCache =
        (cached.meta as { semanticCache?: Record<string, unknown> } | undefined)?.semanticCache ?? {}
      return {
        ...meta,
        semanticCache: { ...semanticCache, replay: true },
      } as TraceMeta
    },
  }
}


