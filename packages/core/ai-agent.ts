/**
 * `@crux/core/ai-agent` — AI SDK agent adapter.
 *
 * Resolves prompts for use with AI SDK-based agent frameworks that handle
 * model calls internally (e.g. `@convex-dev/agent`, Mastra).
 *
 * Unlike `generate()` / `stream()` from `@crux/ai`, which execute
 * the model call directly, `resolve()` returns the composed instructions
 * and a wrapped model. The wrapped model automatically reports execution
 * traces (duration, token usage, success/failure) through the global hooks
 * (e.g. devtools).
 *
 * Requires `ai` (Vercel AI SDK) as a peer dependency for `wrapLanguageModel`.
 *
 * @example
 * ```ts
 * import { resolve } from '@crux/core/ai-agent'
 * import { Agent } from '@convex-dev/agent'
 *
 * const { instructions, model } = await resolve(karylaAgent, {
 *   model: languageModel,
 *   input: { mode },
 * })
 *
 * return new Agent(components.agent, {
 *   languageModel: model,
 *   instructions,
 *   tools,
 * })
 * ```
 *
 * @module
 */

import { wrapLanguageModel } from 'ai'
import type {
  LanguageModelV3,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3CallOptions,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider'
import type { z } from 'zod'
import type { Prompt, ContextEntry, MergedInput, InspectResult } from './types'
import type { ExecutionHook } from './middleware'
import { getRuntime } from './runtime'
import { captureSource } from './project-index/source'
import { runWithExecutionContext, getExecutionContext } from './execution-context'
import type { ToolModelOutput } from './types/tool'
import {
  getLatestSkillState as _getLatestSkillState,
  getNewlyActivatedSkills as _getNewlyActivatedSkills,
  markSkillsInjected as _markSkillsInjected,
} from './skill/state'

/** Best-effort model identifier extraction (string, or `.modelId` on wrapped instances). */
function getModelId(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const id = (model as { modelId?: unknown }).modelId
    if (typeof id === 'string') return id
  }
  return String(model)
}

/** Minimal structural shape of AI SDK message parts read by this module. */
interface MessagePart {
  type?: string
  text?: string
  delta?: string
  toolCallId?: string
  output?: { type: string; value?: unknown; reason?: string }
}

/** Minimal structural shape of AI SDK conversation messages read by this module. */
interface PromptMessage {
  role: string
  content?: string | MessagePart[]
}

// ─────────────────────────────────────────────────────────────────
// Options Type
// ─────────────────────────────────────────────────────────────────

/** Options for `resolve()`. */
export type AgentResolveOptions<TOwnInput extends z.ZodType, TContexts extends readonly ContextEntry[]> = {
  /** The AI SDK language model instance. Returned (possibly wrapped) for agent use. */
  model: LanguageModelV3
  /** Optional token budget for system message composition. */
  tokenBudget?: number
  /**
   * Tool names registered with the agent framework.
   * These are included in the devtools inspect data alongside prompt/context-level tools.
   * Pass `Object.keys(tools)` from your agent configuration.
   */
  tools?: string[]
} & ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
  ? { input?: undefined }
  : { input: MergedInput<TOwnInput, TContexts> })

// ─────────────────────────────────────────────────────────────────
// resolve()
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a prompt for use as agent instructions.
 *
 * Composes the prompt's system message (including all `use` contexts),
 * fires the resolve hook (prompt composition trace), and wraps the model
 * with execution middleware (model call traces with real usage data).
 *
 * This is the agent-framework counterpart of `generate()` from
 * `@crux/ai` — same resolution pipeline, same devtools
 * integration, but returns instructions + model for the agent framework
 * to use.
 *
 * @returns The resolved instructions and a (possibly wrapped) model.
 */
export async function resolve<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  opts: AgentResolveOptions<TOwnInput, TContexts>,
): Promise<{ instructions: string; model: LanguageModelV3 }> {
  const optsRecord = opts as AgentResolveOptions<TOwnInput, TContexts> & {
    input?: Record<string, unknown>
    tokenBudget?: number
    tools?: string[]
  }
  const input = optsRecord.input ?? {}
  const resolveOpts = { input, tokenBudget: optsRecord.tokenBudget }

  // Capture source location before any async work (stack points to caller)
  const source = captureSource()

  type PromptResolveOpts = Parameters<typeof prompt.resolve>[0]
  const resolved = await prompt.resolve(resolveOpts as unknown as PromptResolveOpts)

  // Always compute inspect — needed for middleware even without resolve hook
  const inspect = await prompt.inspect(resolveOpts as unknown as PromptResolveOpts)
  // Merge caller-provided tool names (agent framework tools) into inspect
  if (optsRecord.tools && optsRecord.tools.length > 0) {
    const existing = inspect.tools ?? []
    inspect.tools = [...new Set([...existing, ...optsRecord.tools])]
  }

  // Fire resolve hook (prompt composition trace) and capture its traceId
  let resolveTraceId: string | undefined
  const resolveHook = getRuntime().resolveHook
  if (resolveHook) {
    const hookResult = await resolveHook({
      promptId: prompt.id,
      input,
      inspect,
      source,
    })
    if (hookResult && typeof hookResult === 'object' && 'traceId' in hookResult) {
      resolveTraceId = hookResult.traceId
    }
  }

  // Wrap model with execution middleware if hook is registered
  const executionHook = getRuntime().executionHook
  const model = executionHook
    ? wrapLanguageModel({
        model: opts.model,
        middleware: createTracingMiddleware(prompt.id, executionHook, resolveTraceId, inspect),
      })
    : opts.model

  return { instructions: resolved.system ?? '', model }
}

// ─────────────────────────────────────────────────────────────────
// Model Middleware
// ─────────────────────────────────────────────────────────────────

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

/**
 * Extract cost from providerMetadata if the provider returns it.
 * Duplicated from @crux/ai (core cannot depend on ai).
 */
function extractCost(providerMetadata: SharedV3ProviderMetadata | undefined): number | undefined {
  if (!providerMetadata) return undefined
  const openrouter = providerMetadata.openrouter as { usage?: { cost?: unknown } } | undefined
  const orCost = openrouter?.usage?.cost
  if (typeof orCost === 'number') return orCost
  for (const provider of Object.values(providerMetadata)) {
    const p = provider as { usage?: { cost?: unknown }; cost?: unknown } | undefined
    const cost = p?.usage?.cost ?? p?.cost
    if (typeof cost === 'number') return cost
  }
  return undefined
}

let execCounter = 0

function generateExecTraceId(): string {
  execCounter++
  return `${Date.now()}-exec-${execCounter}-${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────
// Step Gap Timing (for estimated tool execution duration)
// ─────────────────────────────────────────────────────────────────

/** Tracks the end of a model step that had tool calls, for estimating tool execution time. */
interface StepTimingEntry {
  lastFlushAt: number
  toolCalls: Array<{ id?: string; name: string; traceId: string }>
}

const stepTimingMap = new Map<string, StepTimingEntry>()
const STEP_TIMING_TTL = 60_000

/** Remove stale step timing entries to prevent memory leaks. */
function cleanStaleStepTimings(): void {
  const now = Date.now()
  for (const [key, entry] of stepTimingMap) {
    if (now - entry.lastFlushAt > STEP_TIMING_TTL) stepTimingMap.delete(key)
  }
}

/**
 * Emit estimated tool:end events when we detect a new model step that
 * includes tool results from a prior step.
 */
function emitEstimatedToolEnds(params: LanguageModelV3CallOptions, timingKey: string): void {
  const hooks = getRuntime().instrumentationHooks
  if (!hooks?.onToolEnd) return

  // Check if this step has tool results from a prior step
  const prompt = params.prompt as unknown as PromptMessage[] | undefined
  const hasToolResults = prompt?.some((m) => m.role === 'tool')
  if (!hasToolResults) return

  const prev = stepTimingMap.get(timingKey)
  if (!prev) return

  // Extract tool results from the prompt's role:'tool' messages so we can
  // include actual output in the estimated tool:end events
  const resultMap = new Map<string, unknown>()
  for (const msg of prompt ?? []) {
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part?.type !== 'tool-result' || !part.toolCallId) continue
      const output = part.output
      if (output?.type === 'text') resultMap.set(part.toolCallId, { modelOutput: output, result: output.value })
      else if (output?.type === 'json') resultMap.set(part.toolCallId, { modelOutput: output, result: output.value })
      else if (output?.type === 'execution-denied')
        resultMap.set(part.toolCallId, {
          modelOutput: output,
          result: {
            _denied: true,
            reason: output.reason,
          },
        })
    }
  }

  const estimatedMs = Date.now() - prev.lastFlushAt
  for (const tc of prev.toolCalls) {
    const callId = tc.id ?? `est_${Date.now()}`
    const shaped = tc.id ? (resultMap.get(tc.id) as { modelOutput?: ToolModelOutput; result?: unknown } | undefined) : undefined
    hooks.onToolEnd({
      toolCallId: callId,
      toolName: tc.name,
      durationMs: estimatedMs,
      result: shaped?.result,
      modelOutput: shaped?.modelOutput,
      modelOutputType: shaped?.modelOutput?.type,
      estimated: true,
      traceId: tc.traceId,
    })
  }
  stepTimingMap.delete(timingKey)
}

/**
 * Create AI SDK language model middleware that reports execution
 * traces through the global execution hook.
 *
 * Captures parent-child relationships (resolve → agent-step),
 * streaming metrics, and propagates trace context so nested
 * generate() calls inside tool handlers link correctly.
 */
function createTracingMiddleware(
  promptId: string | undefined,
  hook: ExecutionHook,
  parentResolveTraceId?: string,
  resolveInspect?: InspectResult,
): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, model, params }) => {
      const startedAt = Date.now()
      const traceId = generateExecTraceId()
      const ctx = getExecutionContext()
      const instrumentationHooks = getRuntime().instrumentationHooks
      const timingKey = parentResolveTraceId ?? traceId

      // Emit estimated tool:end events from previous step's tool calls
      emitEstimatedToolEnds(params, timingKey)
      cleanStaleStepTimings()

      // ── Skill re-resolution for AI SDK path ──
      // Between steps, check if LoadSkill activated new skills.
      // If so, inject their instructions into the system prompt.
      const skillState = _getLatestSkillState()
      if (skillState) {
        const newSkills = _getNewlyActivatedSkills(skillState)
        if (newSkills.length > 0) {
          const promptArr = params.prompt as unknown as PromptMessage[] | undefined
          if (Array.isArray(promptArr)) {
            // Find the system message and append skill instructions
            for (const msg of promptArr) {
              if (msg.role === 'system') {
                const skillInstructions = newSkills
                  .map((id) => {
                    const s = skillState.available.get(id)
                    return s ? `\n\n## Skill: ${s.id}\n\n${s.instructions}` : ''
                  })
                  .join('')
                if (typeof msg.content === 'string') {
                  msg.content += skillInstructions
                } else if (Array.isArray(msg.content)) {
                  msg.content.push({ type: 'text', text: skillInstructions })
                }
                break
              }
            }
          }
          _markSkillsInjected(newSkills)
          for (const id of newSkills) {
            instrumentationHooks?.onSkillResolve?.({ skillId: id })
          }
        }
      }

      try {
        // Wrap in trace context so nested generate() calls link to this trace
        const result = await runWithExecutionContext(
          {
            traceId,
            sessionId: ctx?.sessionId,
            flowId: ctx?.flowId,
            parentFlowId: ctx?.parentFlowId,
            stepId: ctx?.stepId,
            stepLabel: ctx?.stepLabel,
          },
          () => doGenerate(),
        )
        // Extract tool calls from content array
        const toolCalls = result.content
          .filter((c): c is typeof c & { type: 'tool-call' } => c.type === 'tool-call')
          .map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: safeParseJson(tc.input),
          }))

        // Emit tool:start for legacy instrumentation hooks. Canonical tool
        // execution spans are emitted by the adapter/tool runtime via
        // `@crux/core/observability`.
        if (instrumentationHooks?.onToolStart) {
          for (const tc of toolCalls) {
            const callId = tc.id ?? `tc_${Date.now()}`
            instrumentationHooks.onToolStart({
              toolCallId: callId,
              toolName: tc.name,
              args: tc.args,
              traceId,
            })
          }
        }

        // Record step timing for estimated tool:end on next step
        if (toolCalls.length > 0) {
          stepTimingMap.set(timingKey, {
            lastFlushAt: Date.now(),
            toolCalls: toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              traceId,
            })),
          })
        }

        const durationMs = Date.now() - startedAt
        const cost = extractCost(result.providerMetadata as SharedV3ProviderMetadata | undefined)
        await hook({
          promptId,
          startedAt,
          durationMs,
          model: model.modelId,
          provider: model.provider,
          usage: {
            inputTokens: result.usage.inputTokens?.total,
            outputTokens: result.usage.outputTokens?.total,
          },
          ...(cost != null ? { cost } : {}),
          modelId: model.modelId,
          finishReason: result.finishReason.unified,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          traceId,
          parentResolveTraceId,
          resolveInspect,
        })

        return result
      } catch (error) {
        await hook({
          promptId,
          startedAt,
          durationMs: Date.now() - startedAt,
          model: model.modelId,
          provider: model.provider,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          parentResolveTraceId,
          resolveInspect,
        })
        throw error
      }
    },

    wrapStream: async ({ doStream, model, params }) => {
      const startedAt = Date.now()
      const traceId = generateExecTraceId()
      const ctx = getExecutionContext()
      const progress = getRuntime().streamProgressHook?.(traceId)
      const instrumentationHooks = getRuntime().instrumentationHooks
      const timingKey = parentResolveTraceId ?? traceId

      // Emit estimated tool:end events from previous step's tool calls
      emitEstimatedToolEnds(params, timingKey)
      cleanStaleStepTimings()

      // Send stream-start observability eagerly so the UI can show live progress.
      const streamStartHook = getRuntime().streamStartHook
      const streamStartSent = !!streamStartHook
      if (streamStartHook) {
        await streamStartHook({
          traceId,
          promptId,
          startedAt,
          model: model.modelId,
          provider: model.provider,
          parentResolveTraceId,
        })
      }

      try {
        // Wrap in trace context so nested generate() calls link to this trace
        const result = await runWithExecutionContext(
          {
            traceId,
            sessionId: ctx?.sessionId,
            flowId: ctx?.flowId,
            parentFlowId: ctx?.parentFlowId,
            stepId: ctx?.stepId,
            stepLabel: ctx?.stepLabel,
          },
          () => doStream(),
        )

        // Pipe through a transform to capture finish, tool calls, streaming metrics, and text
        let usage: { inputTokens?: number; outputTokens?: number } | undefined
        let finishReason: string | undefined
        let ttftMs: number | undefined
        let totalChunks = 0
        let streamProviderMetadata: SharedV3ProviderMetadata | undefined
        let streamedText = ''
        const toolCalls: Array<{ id?: string; name: string; args: unknown }> = []

        const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'finish') {
              usage = {
                inputTokens: chunk.usage.inputTokens?.total,
                outputTokens: chunk.usage.outputTokens?.total,
              }
              finishReason = chunk.finishReason.unified
              streamProviderMetadata = (chunk as { providerMetadata?: SharedV3ProviderMetadata }).providerMetadata
            } else if (chunk.type === 'tool-call') {
              const args = safeParseJson(chunk.input)
              toolCalls.push({
                id: chunk.toolCallId,
                name: chunk.toolName,
                args,
              })
              // Emit tool:start for legacy instrumentation hooks. Canonical
              // tool execution spans are emitted by the adapter/tool runtime.
              instrumentationHooks?.onToolStart?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                args,
                traceId,
              })
            } else if (chunk.type === 'text-delta') {
              totalChunks++
              const delta = (chunk as { delta?: string }).delta ?? ''
              streamedText += delta
              if (ttftMs === undefined) {
                ttftMs = Date.now() - startedAt
              }
              progress?.onChunk(delta)
            }
            controller.enqueue(chunk)
          },
          async flush() {
            await progress?.flush()
            const durationMs = Date.now() - startedAt
            const outputTokens = usage?.outputTokens
            const tokensPerSecond =
              outputTokens && durationMs > 0 ? Math.round((outputTokens / durationMs) * 1000) : undefined

            const cost = extractCost(streamProviderMetadata)
            await hook({
              promptId,
              startedAt,
              durationMs,
              model: model.modelId,
              provider: model.provider,
              usage,
              ...(cost != null ? { cost } : {}),
              modelId: model.modelId,
              finishReason,
              ...(toolCalls.length > 0 ? { toolCalls } : {}),
              traceId,
              parentResolveTraceId,
              resolveInspect,
              ...(ttftMs != null ? { streaming: { ttftMs, tokensPerSecond, totalChunks } } : {}),
              streamStartSent,
            })

            // Record step timing for estimated tool:end on next step
            if (toolCalls.length > 0) {
              stepTimingMap.set(timingKey, {
                lastFlushAt: Date.now(),
                toolCalls: toolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  traceId,
                })),
              })
            }

          },
        })

        return { ...result, stream: result.stream.pipeThrough(transform) }
      } catch (error) {
        progress?.dispose()
        await hook({
          promptId,
          startedAt,
          durationMs: Date.now() - startedAt,
          model: model.modelId,
          provider: model.provider,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          parentResolveTraceId,
          resolveInspect,
          streamStartSent,
        })
        throw error
      }
    },
  }
}
