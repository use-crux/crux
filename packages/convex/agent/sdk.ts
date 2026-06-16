/**
 * Convex Agent bridge helpers.
 *
 * Keeps framework-specific tool adaptation out of `@crux/core` while allowing
 * Crux prompt-resolved tools to be registered with `@convex-dev/agent`.
 */

import { Agent as ConvexAgent, createTool as convexCreateTool, fetchContextWithPrompt } from '@convex-dev/agent'
import type { ContextHandler } from '@convex-dev/agent'
import type { AnyToolSet, ContextEntry, MergedInput, Prompt, ResolvedPrompt } from '@crux/core'
import { resolve as resolveAiAgent } from '@crux/ai/agent'
import { observe, type OpenObservedSpan } from '@crux/core/observability'
import type { CruxStore } from '@crux/core/store'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { z } from 'zod'
import type { ComponentApi } from '../src/component/_generated/component'
import { augmentCruxContext } from '../server'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS, flushObservability } from '../observability'
import {
  getConvexCruxRuntime,
  runWithConvexCruxRuntime,
  type ConvexCruxRuntime,
  type ConvexRuntimeTarget,
} from '../runtime'
import { createProfileBackedAgentLifecycle } from './lifecycle'
import type {
  ConvexAgentContextRequest,
  ConvexAgentContextSnapshot,
  ConvexAgentDriver,
  ConvexAgentDriverDefinition,
  ConvexAgentThreadSession,
} from './driver'

const CRUX_WRAPPED_TOOL = Symbol.for('@crux/convex.wrappedTool')
const CRUX_TOOL_NAME = Symbol.for('@crux/convex.toolName')
const CONVEX_AGENT_START_FLUSH_TIMEOUT_MS = 1000
const CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS = DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS
const observedConvexToolCallIds = new Set<string>()
const observedConvexToolRequestIds = new Set<string>()
const MAX_OBSERVED_TOOL_CALL_IDS = 10_000

export type ConvexAgentComponent = ConstructorParameters<typeof ConvexAgent>[0]
type ConvexAgentConstructorOptions = ConstructorParameters<typeof ConvexAgent>[1]
type ConvexAgentPassthroughOptions = Omit<
  ConvexAgentConstructorOptions,
  'name' | 'languageModel' | 'instructions' | 'tools' | 'contextHandler' | 'stopWhen'
>

interface CruxToolDef {
  description?: string
  parameters: z.ZodType
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

type ToolRecord = Record<string, unknown>
type ConvexAgentTool = ReturnType<typeof convexCreateTool>
type ConvexAgentToolOptions = { toolCallId?: string }
type AgentStepMode = 'generate' | 'stream'
type ActiveConvexAgentStepSpan = {
  readonly span: OpenObservedSpan
  readonly key: string | undefined
}
type PrepareStepCallback = (options: unknown) => unknown | Promise<unknown>
type StreamChunkCallback = (event: unknown) => unknown | PromiseLike<unknown>
type StreamTimingTracker = {
  markStarted: () => void
  recordChunk: (event: unknown) => void
  finish: (result: unknown) => Record<string, number> | undefined
}

function wrapToolRecord<TTools extends ToolRecord | undefined>(tools: TTools): TTools {
  if (!tools) return tools
  const wrapped: ToolRecord = {}
  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = wrapConvexTool(tool, { name })
  }
  return wrapped as TTools
}

export class Agent<
  CustomCtx extends object = object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent generic compatibility.
  AgentTools extends Record<string, any> = any,
> extends ConvexAgent<CustomCtx, AgentTools> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent component type is intentionally preserved.
  constructor(component: any, options: ConstructorParameters<typeof ConvexAgent<CustomCtx, AgentTools>>[1]) {
    super(component, {
      ...options,
      tools: wrapToolRecord(options.tools) as AgentTools,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async generateText(...args: any[]): Promise<any> {
    return observeConvexAgentGeneration(
      this.options.name,
      'generation.call',
      'text',
      args,
      this.options.languageModel,
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
        (super.generateText as any)(...args),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async streamText(...args: any[]): Promise<any> {
    return observeConvexAgentTextStream(this.options.name, args, this.options.languageModel, (patchedArgs) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
      (super.streamText as any)(...patchedArgs),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async generateObject(...args: any[]): Promise<any> {
    return observeConvexAgentGeneration(
      this.options.name,
      'generation.call',
      'object',
      args,
      this.options.languageModel,
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
        (super.generateObject as any)(...args),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async streamObject(...args: any[]): Promise<any> {
    return observeConvexAgentGeneration(
      this.options.name,
      'generation.stream',
      'object',
      args,
      this.options.languageModel,
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
        (super.streamObject as any)(...args),
    )
  }
}

async function observeConvexAgentTextStream<T>(
  agentName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent streamText passes a heterogeneous overload tuple.
  args: any[],
  model: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Patched args preserve Convex Agent's overloaded implementation.
  fn: (patchedArgs: any[]) => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  const streamArgs = (args[2] && typeof args[2] === 'object' ? args[2] : {}) as Record<string, unknown>
  const userPrepareStep = streamArgs.prepareStep
  const userOnStepFinish = streamArgs.onStepFinish
  const userOnChunk = streamArgs.onChunk
  const userOnFinish = streamArgs.onFinish
  const options = args[3] && typeof args[3] === 'object' ? (args[3] as Record<string, unknown>) : undefined
  const userContextHandler = options?.contextHandler
  const activeStepSpans: ActiveConvexAgentStepSpan[] = []
  const streamTiming = createStreamTimingTracker()
  const span = observe.openSpan({
    name: 'stream response',
    family: 'generation',
    primitive: 'generation.stream',
    attributes: {
      agentName,
      output: 'text',
      source: 'convex.agent',
      ...modelSpanAttributes(model),
      ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
      ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
    },
  })
  const streamContext = await span.withContext(async () => observe.captureContext())
  let ended = false
  const end = async (attributes?: Record<string, unknown>) => {
    if (ended) return
    ended = true
    endRemainingAgentStepSpans(activeStepSpans, attributes)
    span.end(attributes)
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }
  const fail = async (error: unknown) => {
    if (ended) return
    ended = true
    errorRemainingAgentStepSpans(activeStepSpans, error)
    span.error(error)
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }

  const patchedArgs = [...args]
  if (options && typeof userContextHandler === 'function') {
    patchedArgs[3] = options
    options.contextHandler = async (...handlerArgs: unknown[]) => {
      return await observe.withContext(streamContext, async () => {
        emitConvexAgentMessagesArtifact(args, 'thread-context', handlerArgs[1])
        return await userContextHandler(...handlerArgs)
      })
    }
  }
  // Preserve the stream args object because Convex context handlers mutate it
  // with resolved Crux `system` and `tools` before the provider call starts.
  patchedArgs[2] = streamArgs
  streamArgs.prepareStep = async (options: unknown) => {
    return await observe.withContext(streamContext, async () => {
      const activeStep = openConvexAgentStepSpan(agentName, options, 'stream', model)
      activeStepSpans.push(activeStep)
      try {
        return await activeStep.span.withContext(async () => {
          await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
          if (isPrepareStepCallback(userPrepareStep)) {
            return await userPrepareStep(options)
          }
          return undefined
        })
      } catch (error) {
        removeActiveAgentStepSpan(activeStepSpans, activeStep)
        activeStep.span.error(error)
        throw error
      }
    })
  }
  streamArgs.onStepFinish = async (step: unknown) => {
    try {
      return await observe.withContext(streamContext, async () =>
        observeConvexAgentStep(
          agentName,
          step,
          'stream',
          model,
          async () => (typeof userOnStepFinish === 'function' ? await userOnStepFinish(step) : undefined),
          takeActiveAgentStepSpan(activeStepSpans, step),
        ),
      )
    } catch (error) {
      await fail(error)
      throw error
    }
  }
  streamArgs.onChunk = async (event: unknown) => {
    try {
      streamTiming.recordChunk(event)
      if (isStreamChunkCallback(userOnChunk)) {
        return await observe.withContext(streamContext, async () => await userOnChunk(event))
      }
      return undefined
    } catch (error) {
      await fail(error)
      throw error
    }
  }
  streamArgs.onFinish = async (result: unknown) => {
    try {
      const callbackResult = await observe.withContext(streamContext, async () => {
        await emitResultToolCallSpans(result)
        emitUsageEvent(result, streamTiming.finish(result))
        if (typeof userOnFinish === 'function') {
          return await userOnFinish(result)
        }
        return undefined
      })
      await end({ finish: 'stream' })
      return callbackResult
    } catch (error) {
      await fail(error)
      throw error
    }
  }

  try {
    await span.withContext(() => {
      emitConvexAgentMessagesArtifact(args, 'call-args')
      return flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
    })
    streamTiming.markStarted()
    const result = await span.withContext(() => fn(patchedArgs))
    if (!ended) {
      await span.withContext(async () => {
        await emitResultToolCallSpans(result)
        emitUsageEvent(result, streamTiming.finish(result))
      })
      await end({ finish: 'return' })
    }
    return result
  } catch (error) {
    await fail(error)
    throw error
  }
}

async function observeConvexAgentGeneration<T>(
  agentName: string,
  primitive: 'generation.call' | 'generation.stream',
  output: 'text' | 'object',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent generation overloads pass heterogeneous tuples.
  args: any[],
  model: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  try {
    return await observe.span(
      {
        name: primitive === 'generation.stream' ? 'stream response' : 'generate response',
        family: 'generation',
        primitive,
        attributes: {
          agentName,
          output,
          source: 'convex.agent',
          ...modelSpanAttributes(model),
          ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
          ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
        },
      },
      async () => {
        await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
        emitConvexAgentMessagesArtifact(args, 'call-args')
        const result = await fn()
        await emitResultToolCallSpans(result)
        emitUsageEvent(result)
        return result
      },
    )
  } finally {
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }
}

async function observeConvexAgentStep<T>(
  agentName: string,
  step: unknown,
  mode: AgentStepMode,
  model: unknown,
  userCallback: () => Promise<T>,
  activeStep?: ActiveConvexAgentStepSpan,
): Promise<T> {
  const stepNumber = numericValue((step as Record<string, unknown> | undefined)?.stepNumber)
  const finishReason =
    step && typeof step === 'object' ? stringValue((step as Record<string, unknown>).finishReason) : undefined
  const stepRecord = step && typeof step === 'object' ? (step as Record<string, unknown>) : undefined
  const usage = stepRecord ? normalizeUsageWithCost(stepRecord.usage, stepRecord) : undefined
  const stepSpan = activeStep?.span ?? openConvexAgentStepSpan(agentName, step, mode, model).span
  try {
    return await stepSpan.withContext(async () => {
      emitStepOutputArtifacts(step)
      await emitUnexecutedToolCallSpans(step)
      emitStreamStepEvent(step)
      return await userCallback()
    })
  } catch (error) {
    stepSpan.error(error, {
      ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
      ...(finishReason ? { finishReason } : {}),
    })
    throw error
  } finally {
    stepSpan.end({
      status: finishReason === 'error' ? 'error' : 'ok',
      ...(usage ? { metrics: usage } : {}),
      attributes: {
        ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
        ...(finishReason ? { finishReason } : {}),
      },
    })
  }
}

function openConvexAgentStepSpan(
  agentName: string,
  step: unknown,
  mode: AgentStepMode,
  model: unknown,
): ActiveConvexAgentStepSpan {
  const stepNumber = numericValue((step as Record<string, unknown> | undefined)?.stepNumber)
  const finishReason =
    step && typeof step === 'object' ? stringValue((step as Record<string, unknown>).finishReason) : undefined
  const span = observe.openSpan({
    name: typeof stepNumber === 'number' ? `step ${stepNumber + 1}` : `${mode} step`,
    family: 'generation',
    primitive: 'generation.call',
    attributes: {
      agentName,
      mode,
      output: 'text',
      source: 'convex.agent.step',
      ...modelSpanAttributes(model),
      ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
      ...(finishReason ? { finishReason } : {}),
    },
    implicitRun: false,
  })
  return {
    span,
    key: stepKey(step),
  }
}

function modelSpanAttributes(model: unknown): Record<string, string> {
  const modelId = modelStringValue(model, ['modelId', 'model'])
  const provider = modelStringValue(model, ['provider', 'providerId'])
  return {
    ...(modelId ? { model: modelId } : {}),
    ...(provider ? { provider } : {}),
  }
}

function modelStringValue(model: unknown, keys: readonly string[]): string | undefined {
  if (typeof model === 'string') {
    return keys.includes('modelId') || keys.includes('model') ? model : undefined
  }
  if (!model || typeof model !== 'object') return undefined
  const record = model as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function takeActiveAgentStepSpan(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  step: unknown,
): ActiveConvexAgentStepSpan | undefined {
  if (activeStepSpans.length === 0) return undefined
  const key = stepKey(step)
  const index = key ? activeStepSpans.findIndex((entry) => entry.key === key) : 0
  if (index < 0) return activeStepSpans.shift()
  const [entry] = activeStepSpans.splice(index, 1)
  return entry
}

function removeActiveAgentStepSpan(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  step: ActiveConvexAgentStepSpan,
): void {
  const index = activeStepSpans.indexOf(step)
  if (index >= 0) activeStepSpans.splice(index, 1)
}

function endRemainingAgentStepSpans(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  attributes: Record<string, unknown> | undefined,
): void {
  while (activeStepSpans.length > 0) {
    const activeStep = activeStepSpans.shift()
    activeStep?.span.end({
      status: 'ok',
      attributes: {
        source: 'convex.agent.step',
        ...(attributes ?? {}),
      },
    })
  }
}

function errorRemainingAgentStepSpans(activeStepSpans: ActiveConvexAgentStepSpan[], error: unknown): void {
  while (activeStepSpans.length > 0) {
    const activeStep = activeStepSpans.shift()
    activeStep?.span.error(error)
  }
}

function stepKey(step: unknown): string | undefined {
  const stepNumber = numericValue((step as Record<string, unknown> | undefined)?.stepNumber)
  return typeof stepNumber === 'number' ? String(stepNumber) : undefined
}

function isPrepareStepCallback(value: unknown): value is PrepareStepCallback {
  return typeof value === 'function'
}

function isStreamChunkCallback(value: unknown): value is StreamChunkCallback {
  return typeof value === 'function'
}

function createStreamTimingTracker(now: () => number = Date.now): StreamTimingTracker {
  let startedAt: number | undefined
  let firstOutputAt: number | undefined
  let totalChunks = 0

  const markStarted = () => {
    startedAt ??= now()
  }

  return {
    markStarted,
    recordChunk(event: unknown) {
      markStarted()
      if (!isOutputStreamChunkEvent(event)) return
      totalChunks += 1
      firstOutputAt ??= now()
    },
    finish(result: unknown) {
      markStarted()
      const finishedAt = now()
      const metrics: Record<string, number> = {}
      if (typeof firstOutputAt === 'number' && typeof startedAt === 'number') {
        metrics.ttftMs = Math.max(0, firstOutputAt - startedAt)
      }
      if (totalChunks > 0) {
        metrics.totalChunks = totalChunks
      }
      const usage = usageFromResult(result)
      if (usage?.outputTokens !== undefined && typeof firstOutputAt === 'number') {
        const streamingSeconds = Math.max((finishedAt - firstOutputAt) / 1000, 0.001)
        metrics.tokensPerSecond = usage.outputTokens / streamingSeconds
      }
      return Object.keys(metrics).length > 0 ? metrics : undefined
    },
  }
}

function isOutputStreamChunkEvent(event: unknown): boolean {
  if (!isRecord(event)) return false
  const chunk = event.chunk
  if (!isRecord(chunk)) return false
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
}

function usageFromResult(result: unknown): Record<string, number> | undefined {
  const record = isRecord(result) ? result : undefined
  if (!record) return undefined
  return normalizeUsageWithCost(record.usage ?? record.totalUsage, record)
}

function emitUsageEvent(result: unknown, fallbackMetrics?: Record<string, number>): void {
  const usage = mergeNumberMetrics(usageFromResult(result), fallbackMetrics)
  if (!usage) return
  observe.event({
    name: 'usage.observed',
    attributes: usage,
  })
}

function mergeNumberMetrics(
  primary: Record<string, number> | undefined,
  fallback: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const merged: Record<string, number> = {}
  for (const source of [fallback, primary]) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function emitStepOutputArtifacts(step: unknown): void {
  if (!step || typeof step !== 'object') return
  const record = step as Record<string, unknown>
  const text = stringValue(record.text)
  if (text) {
    const artifactId = observe.artifact({
      kind: 'output',
      contentType: 'text/plain',
      encoding: 'text',
      preview: text,
      attributes: {
        source: 'convex.agent.step',
        ...(typeof numericValue(record.stepNumber) === 'number' ? { stepNumber: numericValue(record.stepNumber) } : {}),
        size: text.length,
      },
    })
    linkActiveSpanToArtifact('produced', artifactId)
  }
  const content = Array.isArray(record.content) ? record.content : undefined
  if (content && content.length > 0) {
    const artifactId = observe.artifact({
      kind: 'messages',
      contentType: 'application/json',
      encoding: 'json',
      preview: content,
      attributes: {
        source: 'convex.agent.step',
        ...(typeof numericValue(record.stepNumber) === 'number' ? { stepNumber: numericValue(record.stepNumber) } : {}),
        partCount: content.length,
      },
    })
    linkActiveSpanToArtifact('produced', artifactId)
  }
}

async function emitUnexecutedToolCallSpans(step: unknown): Promise<void> {
  const toolCalls = collectToolCalls(step)
  for (const toolCall of toolCalls) {
    await emitUnexecutedToolCallSpan(toolCall)
  }
}

async function emitResultToolCallSpans(result: unknown): Promise<void> {
  const toolCalls = collectMaterializedResultToolCalls(result)
  for (const toolCall of toolCalls) {
    await emitUnexecutedToolCallSpan(toolCall)
  }
}

function collectMaterializedResultToolCalls(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== 'object') return []
  const toolCalls = collectToolCalls(result)

  const record = result as Record<string, unknown>
  for (const key of ['finalStep', 'steps', 'toolCalls'] as const) {
    const value = record[key]
    if (!value) continue
    if (typeof (value as PromiseLike<unknown>).then === 'function') continue
    toolCalls.push(...collectToolCalls(value))
  }
  return toolCalls
}

function collectToolCalls(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const collected: Record<string, unknown>[] = []
  appendToolCalls(collected, record.toolCalls)
  appendToolCalls(collected, record.staticToolCalls)
  appendToolCalls(collected, record.dynamicToolCalls)
  appendToolCallsFromContent(collected, record.content)
  appendToolCallsFromContent(collected, record.parts)
  appendToolCallsFromSteps(collected, record.steps)
  appendToolCallsFromSteps(collected, record.response)
  return collected
}

async function emitUnexecutedToolCallSpan(toolCall: Record<string, unknown>): Promise<void> {
  const toolCallId = stringValue(toolCall.toolCallId) ?? stringValue(toolCall.id)
  const toolName = stringValue(toolCall.toolName) ?? stringValue(toolCall.name) ?? toolCallId
  if (!toolCallId) return
  emitToolRequestArtifact(toolName, toolCallId, toolCallArgs(toolCall))
  if (observedConvexToolCallIds.has(toolCallId)) return
  if (!isStopConditionTool(toolName)) return
  markObservedToolCall(toolCallId)
  await observe.span(
    {
      name: toolName ?? toolCallId,
      family: 'tool',
      primitive: 'tool.call',
      attributes: {
        ...(toolName ? { toolName } : {}),
        toolCallId,
        source: 'convex.agent.step',
        executed: false,
        ...(isStopConditionTool(toolName) ? { stopCondition: true } : {}),
      },
    },
    async () => {
      emitToolArgsArtifact(toolName, toolCallId, toolCallArgs(toolCall))
    },
  )
}

function appendToolCalls(target: Record<string, unknown>[], value: unknown): void {
  if (!Array.isArray(value)) return
  for (const toolCall of value) {
    if (!toolCall || typeof toolCall !== 'object') continue
    target.push(toolCall as Record<string, unknown>)
  }
}

function appendToolCallsFromContent(target: Record<string, unknown>[], value: unknown): void {
  if (!Array.isArray(value)) return
  for (const part of value) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    const type = stringValue(record.type)
    if (type && !type.includes('tool')) continue
    if (record.toolCall && typeof record.toolCall === 'object') {
      target.push(record.toolCall as Record<string, unknown>)
      continue
    }
    if (record.toolCallId || record.id || record.toolName || record.name) {
      target.push(record)
    }
  }
}

function appendToolCallsFromSteps(target: Record<string, unknown>[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const step of value) target.push(...collectToolCalls(step))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  appendToolCallsFromSteps(target, record.messages)
  appendToolCallsFromContent(target, record.content)
}

function isStopConditionTool(toolName: string | undefined): boolean {
  return toolName === 'askUserQuestion' || toolName === 'suggestModeSwitch'
}

function emitStreamStepEvent(step: unknown): void {
  if (!step || typeof step !== 'object') return undefined
  const record = step as Record<string, unknown>
  const stopConditionTool = collectToolCalls(step)
    .map((toolCall) => stringValue(toolCall.toolName) ?? stringValue(toolCall.name))
    .find((toolName) => isStopConditionTool(toolName))
  const finishReason = stringValue(record.finishReason)
  if (!finishReason && !stopConditionTool) return
  observe.event({
    name: 'generation.step',
    attributes: {
      ...(finishReason ? { finishReason } : {}),
      ...(stopConditionTool ? { stopConditionTool } : {}),
    },
  })
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function emitConvexAgentMessagesArtifact(
  args: readonly unknown[],
  phase: 'call-args' | 'thread-context',
  contextArgs?: unknown,
): void {
  const threadOpts = args[1] && typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined
  const callArgs = args[2] && typeof args[2] === 'object' ? (args[2] as Record<string, unknown>) : undefined
  const context = contextArgs && typeof contextArgs === 'object' ? (contextArgs as Record<string, unknown>) : undefined
  const artifactId = observe.artifact({
    kind: 'messages',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      source: 'convex.agent',
      phase,
      threadId: stringValue(threadOpts?.threadId),
      userId: stringValue(threadOpts?.userId),
      promptMessageId: stringValue(callArgs?.promptMessageId),
      prompt: callArgs?.prompt,
      system: callArgs?.system,
      messages: callArgs?.messages,
      allMessages: context?.allMessages,
      inputMessages: context?.inputMessages,
      inputPrompt: context?.inputPrompt,
      recent: context?.recent,
      existingResponses: context?.existingResponses,
      search: context?.search,
    },
    attributes: {
      source: 'convex.agent',
      phase,
      ...(stringValue(threadOpts?.threadId) ? { threadId: stringValue(threadOpts?.threadId) } : {}),
      ...(stringValue(callArgs?.promptMessageId) ? { promptMessageId: stringValue(callArgs?.promptMessageId) } : {}),
    },
  })
  linkActiveSpanToArtifact('consumed', artifactId)
}

function linkActiveSpanToArtifact(
  edgeType: 'consumed' | 'produced',
  artifactId: ReturnType<typeof observe.artifact>,
): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!artifactId || !spanId) return
  observe.edge({
    edgeType,
    from: edgeType === 'produced' ? { kind: 'span', id: spanId } : { kind: 'artifact', id: artifactId },
    to: edgeType === 'produced' ? { kind: 'artifact', id: artifactId } : { kind: 'span', id: spanId },
  })
}

function markObservedToolCall(toolCallId: string): void {
  if (observedConvexToolCallIds.size > MAX_OBSERVED_TOOL_CALL_IDS) observedConvexToolCallIds.clear()
  observedConvexToolCallIds.add(toolCallId)
}

function markObservedToolRequest(toolCallId: string): boolean {
  if (observedConvexToolRequestIds.size > MAX_OBSERVED_TOOL_CALL_IDS) observedConvexToolRequestIds.clear()
  if (observedConvexToolRequestIds.has(toolCallId)) return false
  observedConvexToolRequestIds.add(toolCallId)
  return true
}

function toolCallArgs(toolCall: Record<string, unknown>): unknown {
  if ('args' in toolCall) return toolCall.args
  if ('input' in toolCall) return toolCall.input
  if ('arguments' in toolCall) return toolCall.arguments
  return undefined
}

function emitToolRequestArtifact(toolName: string | undefined, toolCallId: string, args: unknown): void {
  if (!markObservedToolRequest(toolCallId)) return
  const spanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'tool.request',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      ...(toolName ? { toolName } : {}),
      toolCallId,
      args,
    },
    attributes: {
      ...(toolName ? { toolName } : {}),
      toolCallId,
      inputSize: measureUnknown(args),
    },
  })
  if (artifactId && spanId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        ...(toolName ? { toolName } : {}),
        toolCallId,
      },
    })
  }
}

function emitToolArgsArtifact(toolName: string | undefined, toolCallId: string, args: unknown): void {
  const artifactId = observe.artifact({
    kind: 'tool.args',
    contentType: 'application/json',
    encoding: 'json',
    preview: args,
    attributes: {
      ...(toolName ? { toolName } : {}),
      toolCallId,
      inputSize: measureUnknown(args),
    },
  })
  const spanId = observe.captureContext()?.currentSpanId
  if (artifactId && spanId) {
    observe.edge({
      edgeType: 'consumed',
      from: { kind: 'artifact', id: artifactId },
      to: { kind: 'span', id: spanId },
      attributes: {
        ...(toolName ? { toolName } : {}),
        toolCallId,
      },
    })
  }
}

function emitToolResultArtifact(toolName: string | undefined, toolCallId: string, result: unknown): void {
  const artifactId = observe.artifact({
    kind: 'tool.result',
    contentType: 'application/json',
    encoding: 'json',
    preview: result,
    attributes: {
      ...(toolName ? { toolName } : {}),
      toolCallId,
      outputSize: measureUnknown(result),
    },
  })
  const spanId = observe.captureContext()?.currentSpanId
  if (artifactId && spanId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        ...(toolName ? { toolName } : {}),
        toolCallId,
      },
    })
  }
}

function measureUnknown(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return 0
  }
}

function normalizeUsage(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const usage: Record<string, number> = {}
  for (const [target, source] of [
    ['inputTokens', 'inputTokens'],
    ['inputTokens', 'promptTokens'],
    ['outputTokens', 'outputTokens'],
    ['outputTokens', 'completionTokens'],
    ['totalTokens', 'totalTokens'],
    ['reasoningTokens', 'reasoningTokens'],
    ['cacheReadTokens', 'cacheReadTokens'],
    ['cacheReadTokens', 'cachedInputTokens'],
    ['cacheWriteTokens', 'cacheWriteTokens'],
    ['costUsd', 'costUsd'],
    ['costUsd', 'cost'],
    ['costUsd', 'totalCost'],
    ['ttftMs', 'ttftMs'],
    ['tokensPerSecond', 'tokensPerSecond'],
    ['totalChunks', 'totalChunks'],
  ] as const) {
    if (usage[target] !== undefined) continue
    const candidate = record[source]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) usage[target] = candidate
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

function normalizeUsageWithCost(usageSource: unknown, costSource: unknown): Record<string, number> | undefined {
  const usage = normalizeUsage(usageSource) ?? {}
  const fallback = normalizeUsage(costSource)
  if (fallback) {
    for (const [key, value] of Object.entries(fallback)) {
      if (usage[key] === undefined) usage[key] = value
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

export interface CreateAgentOptions {
  name?: string
  model?: unknown
  input?: Record<string, unknown>
  tokenBudget?: number
  tools?: Record<string, unknown>
}

type PromptInput<TPrompt> =
  TPrompt extends Prompt<infer TOwnInput, z.ZodType | undefined, infer TContexts>
    ? MergedInput<TOwnInput, TContexts>
    : never

type AnyConvexPrompt = Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>
type ConvexAgentOperation = 'resolve' | 'generateText' | 'streamText'

export type ConvexAgentContextMessage = {
  role: string
  content?: unknown
}

export interface ConvexAgentPrepareMessages {
  all: readonly ConvexAgentContextMessage[]
  search: readonly ConvexAgentContextMessage[]
  recent: readonly ConvexAgentContextMessage[]
  inputMessages: readonly ConvexAgentContextMessage[]
  inputPrompt: readonly ConvexAgentContextMessage[]
  existingResponses: readonly ConvexAgentContextMessage[]
}

export interface ConvexAgentPrepareArgs<
  TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>,
> {
  ctx: unknown
  target: ConvexRuntimeTarget
  args: ConvexAgentCallArgs<TPrompt>
  input: PromptInput<TPrompt>
  messages?: ConvexAgentPrepareMessages
}

export interface ConvexAgentPrepareResult<
  TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>,
> {
  input?: PromptInput<TPrompt> | Record<string, unknown>
  use?: readonly ContextEntry[]
  prompt?: AnyConvexPrompt
  tools?: ToolRecord
  tokenBudget?: number
  captureMessages?: readonly ConvexAgentContextMessage[]
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
  name?: string
  prompt: TPrompt
  tokenBudget?: number
  tools?: ToolRecord
  prepare?: (
    args: ConvexAgentPrepareArgs<TPrompt>,
  ) => ConvexAgentPrepareResult<TPrompt> | Promise<ConvexAgentPrepareResult<TPrompt>>
  store?: (ctx: unknown) => CruxStore | Promise<CruxStore>
  namespace?:
    | string
    | ((args: {
        input: Record<string, unknown>
        promptId?: string
        target?: ConvexRuntimeTarget
      }) => string | Promise<string>)
}

export type ConvexAgentConfig<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>> =
  ConvexAgentBaseConfig<TPrompt> & ConvexAgentModelConfig

export type ConvexAgentCallArgs<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>> = {
  input: PromptInput<TPrompt>
  tokenBudget?: number
} & Record<string, unknown>

export type ConvexAgentThreadTarget = ConvexRuntimeTarget & {
  threadId: string
}

export interface CruxConvexThread {
  readonly threadId: string
  getMetadata(): Promise<unknown>
  updateMetadata(patch: Record<string, unknown>): Promise<unknown>
  generateText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
  streamText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

interface PreparedAgentCall {
  agent: Agent
  resolved: ResolvedPrompt
  callArgs: Record<string, unknown>
  convexTools: Record<string, unknown>
  input: Record<string, unknown>
  captureMessages?: readonly ConvexAgentContextMessage[]
}

interface ConvexThreadLike {
  readonly threadId: string
  getMetadata(): Promise<unknown>
  updateMetadata(patch: Record<string, unknown>): Promise<unknown>
  generateText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
  streamText(args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

export interface CruxConvexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>> {
  readonly name: string
  readonly prompt: TPrompt
  generateText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  streamText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  resolve(ctx: unknown, target: ConvexRuntimeTarget, args: ConvexAgentCallArgs<TPrompt>): Promise<ResolvedPrompt>
  continueThread(
    ctx: unknown,
    target: ConvexAgentThreadTarget,
    args: ConvexAgentCallArgs<TPrompt>,
  ): Promise<{ thread: CruxConvexThread }>
}

function createDefaultConvexAgentDriver(): ConvexAgentDriver {
  return {
    create(definition) {
      return createDefaultConvexAgentSession(definition)
    },
    fetchContext: fetchThreadContextSnapshot,
    createTool(definition) {
      return convexCreateTool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (toolCtx, args, options?: ConvexAgentToolOptions) =>
          await definition.execute(toolCtx, args as Record<string, unknown>, options),
      })
    },
    wrapTool(tool, options) {
      return wrapConvexTool(tool, options)
    },
  }
}

function createDefaultConvexAgentSession(
  definition: ConvexAgentDriverDefinition,
): ReturnType<ConvexAgentDriver['create']> {
  const agent = new Agent(definition.component, {
    ...definition.options,
    name: definition.name,
    languageModel: definition.languageModel,
    instructions: definition.instructions,
    tools: definition.tools,
  } as never)
  return {
    generateText: async (ctx, target, args, options) =>
      await agent.generateText(ctx as never, target as never, args as never, options as never),
    streamText: async (ctx, target, args, options) =>
      await agent.streamText(ctx as never, target as never, args as never, options as never),
    continueThread: async (ctx, target) => {
      const { thread } = await agent.continueThread(ctx as never, target as never)
      return { thread: thread as ConvexAgentThreadSession }
    },
  }
}

type ConvexContextHandlerArgs = Parameters<ContextHandler>[1]
type ConvexContextHandlerCtx = Parameters<ContextHandler>[0]

async function fetchThreadContextSnapshot(request: ConvexAgentContextRequest): Promise<ConvexAgentContextSnapshot> {
  let captured: ConvexAgentContextSnapshot | undefined
  await fetchContextWithPrompt(
    request.ctx as never,
    request.component as never,
    {
      ...request.agentOptions,
      ...(request.options ?? {}),
      agentName: request.agentName,
      userId: request.target.userId ?? undefined,
      threadId: request.target.threadId,
      prompt: request.callArgs.prompt as never,
      messages: request.callArgs.messages as never,
      promptMessageId: stringValue(request.callArgs.promptMessageId),
      contextHandler: async (_handlerCtx: ConvexContextHandlerCtx, handlerArgs: ConvexContextHandlerArgs) => {
        captured = {
          all: contextMessages(handlerArgs.allMessages),
          search: contextMessages(handlerArgs.search),
          recent: contextMessages(handlerArgs.recent),
          inputMessages: contextMessages(handlerArgs.inputMessages),
          inputPrompt: contextMessages(handlerArgs.inputPrompt),
          existingResponses: contextMessages(handlerArgs.existingResponses),
          threadId: handlerArgs.threadId,
          userId: handlerArgs.userId,
        }
        return handlerArgs.allMessages
      },
    } as never,
  )

  if (!captured) {
    throw new Error('convexAgent().continueThread() could not inspect Convex Agent thread context before generation.')
  }
  return captured
}

export function convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
  config: ConvexAgentConfig<TPrompt>,
): CruxConvexAgent<TPrompt> {
  const lifecycle = createProfileBackedAgentLifecycle({
    ...config,
    driver: createDefaultConvexAgentDriver(),
  })
  return {
    name: lifecycle.name,
    prompt: config.prompt,
    generateText: async (ctx, target, args, options) => await lifecycle.invokeText({ ctx, target, args, options }),
    streamText: async (ctx, target, args, options) => await lifecycle.invokeStream({ ctx, target, args, options }),
    resolve: async (ctx, target, args) => await lifecycle.resolveOnly({ ctx, target, args }),
    continueThread: async (ctx, target, args) => await lifecycle.continueThread({ ctx, target, args }),
  }
}

function contextMessages(messages: readonly unknown[]): readonly ConvexAgentContextMessage[] {
  return messages.map((message) =>
    isRecord(message) ? { role: String(message.role ?? ''), content: message.content } : { role: '' },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function createAgent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent component shape.
  component: any,
  definition: {
    id?: string
    name?: string
    model?: unknown
    languageModel?: unknown
    tools?: AnyToolSet
  },
  options: CreateAgentOptions = {},
): Promise<Agent> {
  const model = options.model ?? definition.model ?? definition.languageModel
  if (!model) {
    throw new Error('createAgent() requires a model for prompt definitions or unbound Crux agents.')
  }

  const inferredTools = definition.tools ? convexTools(definition.tools) : {}
  const tools = {
    ...inferredTools,
    ...wrapToolRecord(options.tools),
  }

  const resolved = await resolveAiAgent(
    definition as Parameters<typeof resolveAiAgent>[0],
    {
      model: model as never,
      input: options.input as never,
      tokenBudget: options.tokenBudget,
      tools: Object.keys(tools),
    } as Parameters<typeof resolveAiAgent>[1],
  )

  return new Agent(component, {
    name: options.name ?? definition.name ?? definition.id ?? 'Crux Agent',
    languageModel: resolved.model as never,
    instructions: resolved.instructions,
    tools,
  })
}

function isCruxToolDef(value: unknown): value is CruxToolDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parameters' in value &&
    'execute' in value &&
    typeof (value as { execute?: unknown }).execute === 'function'
  )
}

function toConvexAgentToolRecord(tools: ToolRecord | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!tools) return result

  for (const [name, tool] of Object.entries(tools)) {
    result[name] = isCruxToolDef(tool) ? createConvexToolFromCruxTool(name, tool) : wrapConvexTool(tool, { name })
  }

  return result
}

function createConvexToolFromCruxTool(name: string, tool: CruxToolDef): ConvexAgentTool {
  const capturedRuntime = getConvexCruxRuntime()
  const convexTool = convexCreateTool({
    description: tool.description,
    inputSchema: tool.parameters,
    execute: async (toolCtx, args, options?: ConvexAgentToolOptions): Promise<unknown> => {
      const toolCallId =
        stringValue(options?.toolCallId) ?? stringValue((toolCtx as { toolCallId?: unknown })?.toolCallId)
      if (!toolCallId) {
        return executeCruxToolWithRuntime(tool, args as Record<string, unknown>, capturedRuntime)
      }
      markObservedToolCall(toolCallId)
      return await observeConvexToolExecution(name, toolCallId, args, async () => {
        return await executeCruxToolWithRuntime(tool, args as Record<string, unknown>, capturedRuntime, toolCallId)
      })
    },
  })
  const meta = convexTool as unknown as { [CRUX_WRAPPED_TOOL]?: boolean; [CRUX_TOOL_NAME]?: string }
  meta[CRUX_WRAPPED_TOOL] = true
  meta[CRUX_TOOL_NAME] = name
  return convexTool
}

function executeCruxToolWithRuntime(
  tool: CruxToolDef,
  args: Record<string, unknown>,
  capturedRuntime: ConvexCruxRuntime<unknown, ConvexRuntimeTarget> | undefined,
  toolCallId?: string,
): Promise<unknown> | unknown {
  const runtime = getConvexCruxRuntime() ?? capturedRuntime
  if (!runtime) return tool.execute(args)
  return runWithConvexCruxRuntime(
    {
      ...runtime,
      ...(toolCallId
        ? {
            target: {
              ...(runtime.target ?? {}),
              toolCallId,
            },
          }
        : {}),
    },
    () => tool.execute(args),
  )
}

/**
 * Convert prompt-resolved tools to Convex Agent `createTool()` objects.
 *
 * Normal Crux `ToolDef` objects are adapted. Existing Convex Agent tools are
 * accepted as an interop path and wrapped for the same canonical tool spans.
 */
export function convexTools(tools: AnyToolSet | undefined): Record<string, ConvexAgentTool> {
  const result: Record<string, ConvexAgentTool> = {}
  if (!tools) return result

  for (const [name, tool] of Object.entries(tools)) {
    if (isCruxToolDef(tool)) {
      result[name] = createConvexToolFromCruxTool(name, tool)
      continue
    }
    if (isConvexAgentTool(tool)) {
      result[name] = wrapConvexTool(tool, { name })
      continue
    }

    throw new Error(
      `Cannot convert tool "${name}" to a Convex Agent tool: expected a Crux ToolDef or Convex Agent tool.`,
    )
  }

  return result
}

function isConvexAgentTool(value: unknown): value is ConvexAgentTool {
  return isRecord(value) && 'inputSchema' in value && 'execute' in value && typeof value.execute === 'function'
}

export const createTool: typeof convexCreateTool = ((definition: Parameters<typeof convexCreateTool>[0]) => {
  const name = typeof definition.title === 'string' && definition.title.trim() ? definition.title : undefined
  return wrapConvexTool(convexCreateTool(definition), { name })
}) as typeof convexCreateTool

/**
 * Wrap a `createTool()`-produced Convex Agent tool with span
 * propagation. Use this when a tool is authored directly against
 * `@convex-dev/agent` (not via {@link convexTools}) but you still
 * want nested boundaries (`delegate`, `flow`, etc.) inside its
 * handler to nest under the tool's span in the trace tree.
 *
 * The wrapped tool's `execute` reads `options.toolCallId` (supplied
 * by Convex Agent at invocation time) and pushes the matching
 * canonical `tool.call` span for the duration of the user handler.
 *
 * @example
 * ```ts
 * import { createTool } from '@convex-dev/agent'
 * import { wrapConvexTool } from '@crux/convex/agent'
 *
 * const research = wrapConvexTool(createTool({
 *   description: '…',
 *   inputSchema: z.object({ … }),
 *   execute: async (ctx, args, options) => {
 *     // nested delegate()/flow() calls here now record
 *     // parentSpanId = this tool's spanId
 *     return await researchDelegate.run(args, { … })
 *   },
 * }))
 * ```
 */
// The Convex Agent createTool() wraps the user's execute in an
// OUTER function whose AI SDK signature is (input, options) with
// `this` bound to the tool object. The outer function internally
// reads `this.ctx` (set by Convex Agent's wrapTools at invocation
// time) and calls the user's handler with (ctx, input, options).
//
// We MUST preserve both the (input, options) signature and the
// `this` binding when wrapping. Calling the outer execute as a
// standalone function drops `this`, which makes the `this.ctx`
// read fail with "Cannot read properties of undefined (reading
// 'ctx')". We also mutate `execute` in place rather than creating
// a new wrapped object, so that any Symbols / property descriptors
// `createTool` set on the tool stay intact.
type ToolOuterExecute = (this: unknown, input: unknown, options: { toolCallId?: string } | undefined) => unknown
type ConvexToolThis = { ctx?: object }

export function wrapConvexTool<T>(tool: T, wrapOptions: { name?: string } = {}): T {
  const target = tool as unknown as { execute?: ToolOuterExecute }
  const meta = target as { [CRUX_WRAPPED_TOOL]?: boolean; [CRUX_TOOL_NAME]?: string }
  if (wrapOptions.name) {
    meta[CRUX_TOOL_NAME] = wrapOptions.name
  }
  if (meta[CRUX_WRAPPED_TOOL]) return tool
  const innerExecute = target.execute
  if (typeof innerExecute !== 'function') return tool
  target.execute = function (this: unknown, input: unknown, options) {
    const toolCallId = options?.toolCallId
    const toolName = meta[CRUX_TOOL_NAME] ?? readToolName(this) ?? readToolName(tool) ?? toolCallId
    const toolThis = withCruxToolContext(this)
    if (!toolCallId) {
      return innerExecute.call(toolThis, input, options)
    }
    markObservedToolCall(toolCallId)
    return observeConvexToolExecution(toolName, toolCallId, input, () => innerExecute.call(toolThis, input, options))
  }
  meta[CRUX_WRAPPED_TOOL] = true
  return tool
}

async function observeConvexToolExecution<T>(
  toolName: string | undefined,
  toolCallId: string,
  input: unknown,
  execute: () => T | Promise<T>,
): Promise<T> {
  const span = observe.openSpan({
    name: toolName ?? toolCallId,
    family: 'tool',
    primitive: 'tool.call',
    attributes: {
      ...(toolName ? { toolName } : {}),
      toolCallId,
    },
  })
  try {
    const result = await span.withContext(async () => {
      emitToolArgsArtifact(toolName, toolCallId, input)
      const output = await execute()
      emitToolResultArtifact(toolName, toolCallId, output)
      return output
    })
    span.end()
    return result
  } catch (error) {
    span.error(error, {
      ...(toolName ? { toolName } : {}),
      toolCallId,
      phase: 'tool.execute',
      errorKind: 'execute_error',
    })
    throw error
  } finally {
    await flushObservability()
  }
}

function withCruxToolContext(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const toolThis = value as ConvexToolThis
  if (!toolThis.ctx || typeof toolThis.ctx !== 'object') return value
  return {
    ...toolThis,
    ctx: augmentCruxContext(toolThis.ctx as never),
  }
}

function readToolName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['name', 'toolName', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return undefined
}
