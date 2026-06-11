/**
 * `AiSdkExecutor` — the `ExecutorSpec` implementation for the Vercel AI SDK.
 *
 * Mechanics only, delegated to SDK-native capabilities wherever one exists
 * (the Crux philosophy — new SDK features should be adopted by deleting
 * code here, not adding it):
 *
 * | Contract obligation        | AI SDK mechanism                          |
 * |----------------------------|-------------------------------------------|
 * | Multi-step loop + budget   | `generateText` + `stopWhen`               |
 * | Per-step steering          | `onStepFinish` (report) + `prepareStep`   |
 * | Tier-1 JSON repair         | `experimental_repairText` → core repair   |
 * | Approval detection         | native `needsApproval` → `suspended`      |
 * | Cancellation               | `abortSignal` from core's timeout         |
 *
 * Policy (routing, retries, approval tokens, constraints, guardrails)
 * lives in `executorAdapter()` in core — never here.
 *
 * @module
 */

import type { LanguageModel, StopCondition, ToolSet } from 'ai'
import type { z } from 'zod'
import type { GenerationSettings, Message, ModelInfo } from '@crux/core'
import { getRuntime, repairJsonText } from '@crux/core'
import { observe } from '@crux/core/observability'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorSpec,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
  StructuredAttempt,
  StructuredRequest,
} from '@crux/core/adapter'
import { toJsonValue } from '@crux/core/adapter'
import type { SdkGateway } from './gateway'
import { buildSystemArg, extractModelInfo, sanitizeSchemaForProvider } from './provider-profile'
import { extractCost, extractRawTextFromError, extractZodError, isObjectGenerationError, normalizeUsage } from './meta'
import type { SdkUsageLike } from './meta'
import { dropTrailingAssistant, fromResponseMessages, toModelMessages } from './messages'

// ─────────────────────────────────────────────────────────────────
// Raw result shapes (structural — the SDK's results pass through untouched)
// ─────────────────────────────────────────────────────────────────

/** Structural shape of the AI SDK generate results this executor reads. */
export interface SdkLoopResultLike {
  text?: string
  object?: unknown
  content?: Array<{ type?: string; approvalId?: string; toolCall?: { toolCallId?: string; toolName?: string; input?: unknown } }>
  steps?: ReadonlyArray<unknown>
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown; args?: unknown }>
  usage?: SdkUsageLike
  totalUsage?: SdkUsageLike
  finishReason?: string
  response?: { id?: string; modelId?: string; messages?: ReadonlyArray<unknown> }
  providerMetadata?: unknown
  _meta?: Record<string, unknown>
}

/** Structural shape of AI SDK stream results this executor returns. */
export interface SdkStreamResultLike {
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

/** Structural shapes of stream callbacks/events we forward. */
interface SdkStreamChunkEvent {
  chunk?: { type?: string; textDelta?: string }
}
interface SdkStreamFinishEvent extends SdkLoopResultLike {}

type LoopArgs = Record<string, unknown>

const APPROVAL_PART = 'tool-approval-request'

// ─────────────────────────────────────────────────────────────────
// Request → SDK args
// ─────────────────────────────────────────────────────────────────

function buildBaseArgs(
  request: ExecutorRequest<LanguageModel>,
  options: { includeTools: boolean },
): LoopArgs {
  const args: LoopArgs = {
    model: request.model,
    ...request.settings,
  }

  const systemArg = buildSystemArg(request.systemBlocks, request.system, request.modelInfo)
  if (systemArg !== undefined) args.system = systemArg

  if (request.messages && request.messages.length > 0) {
    args.messages = toModelMessages(request.messages)
  } else if (request.prompt) {
    args.prompt = request.prompt
  }

  if (options.includeTools) {
    if (request.tools && Object.keys(request.tools).length > 0) args.tools = request.tools
    if (request.activeTools && request.activeTools.length > 0) args.activeTools = [...request.activeTools]
    const toolChoice = request.extra?.toolChoice
    if (toolChoice !== undefined) args.toolChoice = toolChoice
  }

  if (request.abortSignal) args.abortSignal = request.abortSignal
  return args
}

function canonicalBase(request: ExecutorRequest<LanguageModel>): Message[] {
  if (request.messages && request.messages.length > 0) return [...request.messages]
  if (request.prompt) return [{ role: 'user', content: request.prompt }]
  return []
}

function extractResponse(result: SdkLoopResultLike): import('@crux/core/adapter').AdapterResponse {
  return {
    text: result.text ?? '',
    toolCalls:
      result.toolCalls && result.toolCalls.length > 0
        ? result.toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input ?? tc.args }))
        : undefined,
    usage: normalizeUsage(result.totalUsage ?? result.usage),
    finishReason: result.finishReason,
    responseId: result.response?.id,
    actualModelId: result.response?.modelId,
  }
}

// ─────────────────────────────────────────────────────────────────
// The spec
// ─────────────────────────────────────────────────────────────────

/**
 * The `ExecutorSpec` binding the Vercel AI SDK to `executorAdapter()`.
 *
 * Bind it with a gateway: `executorAdapter(aiSdkExecutor)(liveSdkGateway())`.
 * Tests bind a scripted gateway instead, or pass `MockLanguageModelV3`
 * models through the live gateway for loop-fidelity coverage.
 *
 * @remarks
 * Known limitations of the AI SDK binding, by SDK design:
 * - An `amend` directive's `tools` replacement cannot swap the tool map
 *   mid-loop (the SDK's `prepareStep` only supports `activeTools`
 *   restriction); amended `system`, `systemBlocks`, and `activeTools`
 *   apply from the next step.
 * - When the caller supplies an explicit `stopWhen` (via `extra`), it
 *   replaces the `maxSteps` budget, and `refundStep` cannot extend it.
 */
export const aiSdkExecutor: ExecutorSpec<SdkGateway, LanguageModel, SdkLoopResultLike, SdkStreamResultLike> = {
  executorId: 'ai-sdk',

  describeModel(model: LanguageModel): ModelInfo {
    return extractModelInfo(model)
  },

  mapSettings(settings: GenerationSettings): Record<string, unknown> {
    // Resolved Crux settings flow into AI SDK args verbatim — prompts
    // author settings in AI SDK vocabulary when targeting this adapter.
    return { ...settings }
  },

  async runLoop(
    gateway: SdkGateway,
    request: ExecutorRequest<LanguageModel>,
  ): Promise<ExecutorOutcome<SdkLoopResultLike>> {
    const args = buildBaseArgs(request, { includeTools: true })

    // ── Steering state: directives observed after step N apply before N+1 ──
    let stopReason: string | undefined
    let refunds = 0
    let stepIndex = 0
    let overrides:
      | { system?: ReturnType<typeof buildSystemArg>; activeTools?: readonly string[] }
      | undefined

    const directiveStop: StopCondition<ToolSet> = () => stopReason !== undefined
    const explicitStop = request.extra?.stopWhen as StopCondition<ToolSet> | StopCondition<ToolSet>[] | undefined
    if (explicitStop !== undefined) {
      args.stopWhen = [...(Array.isArray(explicitStop) ? explicitStop : [explicitStop]), directiveStop]
    } else {
      const budget: StopCondition<ToolSet> = ({ steps }) => steps.length >= request.maxSteps + refunds
      args.stopWhen = [directiveStop, budget]
    }

    if (request.observer) {
      const observer = request.observer
      args.onStepFinish = async (step: {
        text: string
        toolCalls: Array<{ toolCallId: string; toolName: string; input?: unknown }>
        toolResults: Array<{ toolCallId: string; toolName: string; output?: unknown }>
        finishReason?: string
        usage?: SdkUsageLike
      }) => {
        const directive = await observer.onStepFinish({
          index: stepIndex,
          text: step.text,
          toolCalls: step.toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input })),
          toolResults: step.toolResults.map((tr) => ({
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            output: tr.output,
          })),
          finishReason: step.finishReason,
          usage: normalizeUsage(step.usage),
        })
        stepIndex++
        if (directive.kind === 'stop') {
          stopReason = directive.reason ?? 'observer'
        } else if (directive.kind === 'amend') {
          if (directive.refundStep) {
            refunds++
            stepIndex--
          }
          overrides = {
            ...(directive.system !== undefined || directive.systemBlocks !== undefined
              ? { system: buildSystemArg(directive.systemBlocks, directive.system, request.modelInfo) }
              : {}),
            ...(directive.activeTools !== undefined ? { activeTools: directive.activeTools } : {}),
          }
        }
      }
      args.prepareStep = () =>
        overrides
          ? {
              ...(overrides.system !== undefined ? { system: overrides.system } : {}),
              ...(overrides.activeTools !== undefined ? { activeTools: [...overrides.activeTools] } : {}),
            }
          : {}
    }

    const result = (await gateway.generateText(args as Parameters<SdkGateway['generateText']>[0])) as SdkLoopResultLike

    const base = canonicalBase(request)
    const sdkSteps = result.steps?.length ?? 1
    const budgetSteps = Math.max(1, sdkSteps - refunds)
    const approvalParts = (result.content ?? []).filter((part) => part.type === APPROVAL_PART)

    if (approvalParts.length > 0) {
      const converted = fromResponseMessages(result.response?.messages ?? [])
      return {
        status: 'suspended',
        reason: 'tool-approval',
        pendingApprovals: approvalParts.map((part) => ({
          toolCallId: part.toolCall?.toolCallId ?? '',
          toolName: part.toolCall?.toolName ?? '',
          input: toJsonValue(part.toolCall?.input),
        })),
        assistantResponse: extractResponse(result),
        messages: [...base, ...dropTrailingAssistant(converted)],
        steps: budgetSteps,
      }
    }

    return {
      status: 'complete',
      raw: result,
      response: extractResponse(result),
      messages: [...base, ...fromResponseMessages(result.response?.messages ?? [])],
      steps: budgetSteps,
      meta: {
        costUsd: extractCost(result.providerMetadata),
        providerMetadata: result.providerMetadata,
      },
    }
  },

  async attemptStructured(
    gateway: SdkGateway,
    request: StructuredRequest<LanguageModel>,
  ): Promise<StructuredAttempt<SdkLoopResultLike>> {
    const args = buildBaseArgs(request, { includeTools: false })
    args.schema = await sanitizeSchemaForProvider(request.schema, request.modelInfo)
    // Tier-1 repair: the SDK fixes cheap text issues (fences, trailing
    // commas) before validation ever fails — wired to core's repair, the
    // one sanctioned policy-in-adapter exception (only the SDK can repair
    // pre-throw).
    args.experimental_repairText = async ({ text }: { text: string }) => {
      const repaired = repairJsonText(text)
      return repaired !== text ? repaired : null
    }

    try {
      const result = (await gateway.generateObject(
        args as Parameters<SdkGateway['generateObject']>[0],
      )) as SdkLoopResultLike
      return {
        status: 'ok',
        raw: result,
        response: extractResponse(result),
        object: result.object,
      }
    } catch (error) {
      if (!isObjectGenerationError(error)) throw error
      return {
        status: 'invalid',
        rawText: extractRawTextFromError(error),
        error: await extractZodError(error),
      }
    }
  },

  async runStream(
    gateway: SdkGateway,
    request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<SdkStreamResultLike>> {
    const args = buildBaseArgs(request, { includeTools: !request.schema })
    const streamStartTime = Date.now()
    let firstChunkTime: number | undefined
    let chunkCount = 0

    const callerOnChunk = request.extra?.onChunk as ((event: SdkStreamChunkEvent) => unknown) | undefined
    const callerOnFinish = request.extra?.onFinish as ((event: SdkStreamFinishEvent) => unknown) | undefined

    let resolveCompletion!: (meta: ExecutorStreamMeta) => void
    let rejectCompletion!: (error: unknown) => void
    const completionPromise = new Promise<ExecutorStreamMeta>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })

    if (request.schema) {
      args.schema = await sanitizeSchemaForProvider(request.schema, request.modelInfo)
      args.onFinish = async (event: SdkStreamFinishEvent) => {
        try {
          resolveCompletion({
            usage: normalizeUsage(event.usage),
            cost: extractCost(event.providerMetadata),
            streaming: {
              ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
              totalChunks: chunkCount,
            },
          })
          await callerOnFinish?.(event)
        } catch (error) {
          rejectCompletion(error)
        }
      }
      const sdkResult = gateway.streamObject(
        args as Parameters<SdkGateway['streamObject']>[0],
      ) as unknown as SdkStreamResultLike
      return withLegacyStreamMeta({ raw: sdkResult, completion: () => completionPromise }, completionPromise)
    }

    const traceId = observe.captureContext()?.traceId
    const progress = traceId ? getRuntime().streamProgressHook?.(traceId) : undefined

    args.onChunk = async (event: SdkStreamChunkEvent) => {
      if (!firstChunkTime) firstChunkTime = Date.now()
      chunkCount++
      const textDelta = event.chunk?.type === 'text-delta' ? event.chunk.textDelta : undefined
      progress?.onChunk(textDelta)
      await callerOnChunk?.(event)
    }
    args.onFinish = async (event: SdkStreamFinishEvent) => {
      try {
        await progress?.flush()
        const durationMs = Date.now() - streamStartTime
        const outputTokens = event.totalUsage?.outputTokens
        const tokensPerSecond =
          durationMs > 0 && outputTokens ? Math.round((outputTokens / durationMs) * 1000) : undefined

        resolveCompletion({
          usage: normalizeUsage(event.totalUsage),
          finishReason: event.finishReason,
          toolCalls:
            event.toolCalls && event.toolCalls.length > 0
              ? event.toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input ?? tc.args }))
              : undefined,
          responseId: event.response?.id,
          actualModelId: event.response?.modelId,
          cost: extractCost(event.providerMetadata),
          text: event.text,
          streaming: {
            ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
            tokensPerSecond,
            totalChunks: chunkCount,
          },
        })
        await callerOnFinish?.(event)
      } catch (error) {
        progress?.dispose()
        rejectCompletion(error)
      }
    }

    const sdkResult = gateway.streamText(
      args as Parameters<SdkGateway['streamText']>[0],
    ) as unknown as SdkStreamResultLike
    return withLegacyStreamMeta({ raw: sdkResult, completion: () => completionPromise }, completionPromise)
  },

  replayStream(cached: {
    readonly text?: string
    readonly object?: unknown
    readonly meta?: Record<string, unknown>
  }): ExecutorStreamHandle<SdkStreamResultLike> {
    const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
    const cachedMeta = (cached.meta ?? {}) as Record<string, unknown>
    const existingSemanticCache = (cachedMeta.semanticCache as Record<string, unknown> | undefined) ?? {}
    const completionMeta: ExecutorStreamMeta = {
      ...(cachedMeta as ExecutorStreamMeta),
      text,
      semanticCache: { ...existingSemanticCache, replay: true },
    } as ExecutorStreamMeta

    function* chunkText(): Generator<string> {
      for (let index = 0; index < text.length; index += 64) {
        yield text.slice(index, index + 64)
      }
    }
    async function* textIterator(): AsyncGenerator<string> {
      yield* chunkText()
    }

    const completionPromise = Promise.resolve(completionMeta)
    const raw: SdkStreamResultLike = {
      ...(cached.object !== undefined ? { object: Promise.resolve(cached.object) } : {}),
      text: Promise.resolve(text),
      textStream: textIterator(),
      fullStream: textIterator(),
      _meta: { ...cachedMeta, _streamCompletion: completionPromise },
    }
    return withLegacyStreamMeta({ raw, completion: () => completionPromise }, completionPromise)
  },
}

/**
 * Attach the legacy `_meta._streamCompletion` location to a stream handle
 * (and its raw result) so middleware written against the old `@crux/ai`
 * stream shape — e.g. core's cost tracker — keeps observing completions.
 */
function withLegacyStreamMeta(
  handle: ExecutorStreamHandle<SdkStreamResultLike>,
  completion: Promise<ExecutorStreamMeta | undefined>,
): ExecutorStreamHandle<SdkStreamResultLike> {
  const rawMeta = (handle.raw._meta as Record<string, unknown> | undefined) ?? {}
  handle.raw._meta = { ...rawMeta, _streamCompletion: completion }
  return Object.assign(handle, { _meta: { _streamCompletion: completion } })
}
