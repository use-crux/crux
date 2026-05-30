/**
 * Convex Agent bridge helpers.
 *
 * Keeps framework-specific tool adaptation out of `@crux/core` while allowing
 * Crux prompt-resolved tools to be registered with `@convex-dev/agent`.
 */

import { Agent as ConvexAgent, createTool as convexCreateTool } from '@convex-dev/agent'
import type { AnyToolSet } from '@crux/core'
import { resolve } from '@crux/core/ai-agent'
import { observe } from '@crux/core/observability'
import type { z } from 'zod'
import { augmentCruxContext } from './server'
import { flushObservability } from './observability'

const CRUX_WRAPPED_TOOL = Symbol.for('@crux/convex.wrappedTool')
const CRUX_TOOL_NAME = Symbol.for('@crux/convex.toolName')
const observedConvexToolCallIds = new Set<string>()
const observedConvexToolRequestIds = new Set<string>()
const MAX_OBSERVED_TOOL_CALL_IDS = 10_000

interface CruxToolDef {
  description?: string
  parameters: z.ZodType
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

type ToolRecord = Record<string, unknown>

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
    return observeConvexAgentGeneration(this.options.name, 'generation.call', 'text', args, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
      (super.generateText as any)(...args),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async streamText(...args: any[]): Promise<any> {
    return observeConvexAgentTextStream(this.options.name, args, (patchedArgs) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
      (super.streamText as any)(...patchedArgs),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async generateObject(...args: any[]): Promise<any> {
    return observeConvexAgentGeneration(this.options.name, 'generation.call', 'object', args, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
      (super.generateObject as any)(...args),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent's overloaded public method shape.
  async streamObject(...args: any[]): Promise<any> {
    return observeConvexAgentGeneration(this.options.name, 'generation.stream', 'object', args, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Forward to Convex Agent's overloaded implementation.
      (super.streamObject as any)(...args),
    )
  }
}

async function observeConvexAgentTextStream<T>(
  agentName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent streamText passes a heterogeneous overload tuple.
  args: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Patched args preserve Convex Agent's overloaded implementation.
  fn: (patchedArgs: any[]) => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  const streamArgs = (args[2] && typeof args[2] === 'object' ? args[2] : {}) as Record<string, unknown>
  const userOnStepFinish = streamArgs.onStepFinish
  const userOnFinish = streamArgs.onFinish
  const span = observe.openSpan({
    name: `stream ${agentName}`,
    family: 'generation',
    primitive: 'generation.stream',
    attributes: {
      agentName,
      output: 'text',
      source: 'convex.agent',
      ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
      ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
    },
  })
  const streamContext = await span.withContext(async () => observe.captureContext())
  let ended = false
  const end = (attributes?: Record<string, unknown>) => {
    if (ended) return
    ended = true
    span.end(attributes)
  }

  const patchedArgs = [...args]
  patchedArgs[2] = {
    ...streamArgs,
    onStepFinish: async (step: unknown) => {
      try {
        return await observe.withContext(streamContext, async () =>
            observeConvexAgentStep(agentName, step, 'stream', async () =>
            typeof userOnStepFinish === 'function' ? await userOnStepFinish(step) : undefined,
          ),
        )
      } catch (error) {
        if (!ended) {
          ended = true
          span.error(error)
        }
        throw error
      }
    },
    onFinish: async (result: unknown) => {
      emitUsageEvent(result)
      end({ finish: 'stream' })
      if (typeof userOnFinish === 'function') {
        return await userOnFinish(result)
      }
      return undefined
    },
  }

  try {
    const result = await span.withContext(() => fn(patchedArgs))
    await span.withContext(async () => {
      await emitResultToolCallSpans(result)
      emitUsageEvent(result)
      end({ finish: 'return' })
    })
    return result
  } catch (error) {
    if (!ended) {
      ended = true
      span.error(error)
    }
    throw error
  }
}

async function observeConvexAgentGeneration<T>(
  agentName: string,
  primitive: 'generation.call' | 'generation.stream',
  output: 'text' | 'object',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent generation overloads pass heterogeneous tuples.
  args: any[],
  fn: () => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  return observe.span(
    {
      name: `${primitive === 'generation.stream' ? 'stream' : 'generate'} ${agentName}`,
      family: 'generation',
      primitive,
      attributes: {
        agentName,
        output,
        source: 'convex.agent',
        ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
        ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
      },
    },
    async () => {
      const result = await fn()
      await emitResultToolCallSpans(result)
      emitUsageEvent(result)
      return result
    },
  )
}

async function observeConvexAgentStep<T>(
  agentName: string,
  step: unknown,
  mode: 'generate' | 'stream',
  userCallback: () => Promise<T>,
): Promise<T> {
  const stepNumber = numericValue((step as Record<string, unknown> | undefined)?.stepNumber)
  const finishReason = step && typeof step === 'object' ? stringValue((step as Record<string, unknown>).finishReason) : undefined
  const stepRecord = step && typeof step === 'object' ? (step as Record<string, unknown>) : undefined
  const usage = stepRecord ? normalizeUsageWithCost(stepRecord.usage, stepRecord) : undefined
  const stepSpan = observe.openSpan({
    name: `${mode} ${agentName}${typeof stepNumber === 'number' ? ` step ${stepNumber + 1}` : ''}`,
    family: 'generation',
    primitive: 'generation.call',
    attributes: {
      agentName,
      mode,
      output: 'text',
      source: 'convex.agent.step',
      ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
      ...(finishReason ? { finishReason } : {}),
    },
    implicitRun: false,
  })
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

function emitUsageEvent(result: unknown): void {
  if (!result || typeof result !== 'object') return
  const record = result as Record<string, unknown>
  const usageSource = record.usage ?? record.totalUsage
  const usage = normalizeUsageWithCost(usageSource, record)
  if (!usage) return
  observe.event({
    name: 'usage.observed',
    attributes: usage,
  })
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

function linkActiveSpanToArtifact(edgeType: 'consumed' | 'produced', artifactId: ReturnType<typeof observe.artifact>): void {
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
    ['cachedInputTokens', 'cachedInputTokens'],
    ['costUsd', 'costUsd'],
    ['costUsd', 'cost'],
    ['costUsd', 'totalCost'],
  ] as const) {
    if (usage[target] !== undefined) continue
    const candidate = record[source]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) usage[target] = candidate
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

function normalizeUsageWithCost(usageSource: unknown, costSource: unknown): Record<string, number> | undefined {
  const usage = normalizeUsage(usageSource) ?? {}
  const cost = normalizeUsage(costSource)
  if (cost?.costUsd !== undefined && usage.costUsd === undefined) {
    usage.costUsd = cost.costUsd
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

  const resolved = await resolve(
    definition as Parameters<typeof resolve>[0],
    {
      model: model as never,
      input: options.input as never,
      tokenBudget: options.tokenBudget,
      tools: Object.keys(tools),
    } as never,
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

/**
 * Convert Crux `ToolDef` objects to Convex Agent `createTool()` objects.
 *
 * Each tool's `execute` is wrapped in a canonical `tool.call` span so
 * any boundary primitive opened inside the handler (`delegate`, `flow`,
 * `handoff`, etc.) records this tool span as its parent.
 *
 * For tools created with `createTool()` from `@convex-dev/agent`
 * directly (not via `convexTools`), use {@link wrapConvexTool} to opt
 * the tool's execute into the same span propagation.
 */
export function convexTools(tools: AnyToolSet | undefined): Record<string, ReturnType<typeof convexCreateTool>> {
  const result: Record<string, ReturnType<typeof convexCreateTool>> = {}
  if (!tools) return result

  for (const [name, tool] of Object.entries(tools)) {
    if (!isCruxToolDef(tool)) {
      throw new Error(`Cannot convert tool "${name}" to a Convex Agent tool: expected a Crux ToolDef.`)
    }

    result[name] = convexCreateTool({
      description: tool.description,
      inputSchema: tool.parameters,
      execute: async (toolCtx, args): Promise<unknown> => {
        const toolCallId = (toolCtx as { toolCallId?: string } | undefined)?.toolCallId
        if (!toolCallId) {
          return tool.execute(args as Record<string, unknown>)
        }
        markObservedToolCall(toolCallId)
        try {
          return await observe.span(
            {
              name,
              family: 'tool',
              primitive: 'tool.call',
              attributes: { toolName: name, toolCallId },
            },
            async () => {
              emitToolArgsArtifact(name, toolCallId, args)
              const result = await tool.execute(args as Record<string, unknown>)
              emitToolResultArtifact(name, toolCallId, result)
              return result
            },
          )
        } finally {
          await flushObservability()
        }
      },
    })
  }

  return result
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
    return (async () => {
      try {
        return await observe.span(
          {
            name: toolName ?? toolCallId,
            family: 'tool',
            primitive: 'tool.call',
            attributes: {
              ...(toolName ? { toolName } : {}),
              toolCallId,
            },
          },
          async () => {
            emitToolArgsArtifact(toolName, toolCallId, input)
            const result = await innerExecute.call(toolThis, input, options)
            emitToolResultArtifact(toolName, toolCallId, result)
            return result
          },
        )
      } finally {
        await flushObservability()
      }
    })()
  }
  meta[CRUX_WRAPPED_TOOL] = true
  return tool
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
