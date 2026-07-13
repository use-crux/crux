import { observe } from '@use-crux/core/observability'
import { flushObservability } from '../observability'
import { isRecord, stringValue } from './lifecycle-utils'
import { linkActiveSpanToArtifact } from './sdk-observability-artifacts'

const observedConvexToolCallIds = new Set<string>()
const observedConvexToolRequestIds = new Set<string>()
const MAX_OBSERVED_TOOL_CALL_IDS = 10_000

/** Remember that a real tool invocation already created the canonical span. */
export function markObservedToolCall(toolCallId: string): void {
  if (observedConvexToolCallIds.size > MAX_OBSERVED_TOOL_CALL_IDS)
    observedConvexToolCallIds.clear()
  observedConvexToolCallIds.add(toolCallId)
}

/** Observe a wrapped Convex Agent tool execution. */
export async function observeConvexToolExecution<T>(
  toolName: string | undefined,
  toolCallId: string,
  input: unknown,
  execute: () => T | Promise<T>,
): Promise<T> {
  const span = observe.openSpan({
    name: toolName ?? toolCallId,
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
    // One tool call within a larger action/stream, not the action's own
    // terminal drain — the enclosing boundary's final flush owns loss reporting.
    await flushObservability({ terminal: false })
  }
}

export async function emitUnexecutedToolCallSpans(
  step: unknown,
): Promise<void> {
  const toolCalls = collectToolCalls(step)
  for (const toolCall of toolCalls) {
    await emitUnexecutedToolCallSpan(toolCall)
  }
}

export async function emitResultToolCallSpans(result: unknown): Promise<void> {
  const toolCalls = collectMaterializedResultToolCalls(result)
  for (const toolCall of toolCalls) {
    await emitUnexecutedToolCallSpan(toolCall)
  }
}

export function emitStreamStepEvent(step: unknown): void {
  if (!step || typeof step !== 'object') return undefined
  const record = step as Record<string, unknown>
  const stopConditionTool = collectToolCalls(step)
    .map(
      (toolCall) =>
        stringValue(toolCall.toolName) ?? stringValue(toolCall.name),
    )
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

function collectMaterializedResultToolCalls(
  result: unknown,
): Record<string, unknown>[] {
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
  if (!isRecord(value)) return []
  const collected: Record<string, unknown>[] = []
  appendToolCalls(collected, value.toolCalls)
  appendToolCalls(collected, value.staticToolCalls)
  appendToolCalls(collected, value.dynamicToolCalls)
  appendToolCallsFromContent(collected, value.content)
  appendToolCallsFromContent(collected, value.parts)
  appendToolCallsFromSteps(collected, value.steps)
  appendToolCallsFromSteps(collected, value.response)
  return collected
}

async function emitUnexecutedToolCallSpan(
  toolCall: Record<string, unknown>,
): Promise<void> {
  const toolCallId =
    stringValue(toolCall.toolCallId) ?? stringValue(toolCall.id)
  const toolName =
    stringValue(toolCall.toolName) ?? stringValue(toolCall.name) ?? toolCallId
  if (!toolCallId) return
  emitToolRequestArtifact(toolName, toolCallId, toolCallArgs(toolCall))
  if (observedConvexToolCallIds.has(toolCallId)) return
  if (!isStopConditionTool(toolName)) return
  markObservedToolCall(toolCallId)
  await observe.span(
    {
      name: toolName ?? toolCallId,
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

function appendToolCalls(
  target: Record<string, unknown>[],
  value: unknown,
): void {
  if (!Array.isArray(value)) return
  for (const toolCall of value) {
    if (!isRecord(toolCall)) continue
    target.push(toolCall)
  }
}

function appendToolCallsFromContent(
  target: Record<string, unknown>[],
  value: unknown,
): void {
  if (!Array.isArray(value)) return
  for (const part of value) {
    if (!isRecord(part)) continue
    const type = stringValue(part.type)
    if (type && !type.includes('tool')) continue
    if (isRecord(part.toolCall)) {
      target.push(part.toolCall)
      continue
    }
    if (part.toolCallId || part.id || part.toolName || part.name) {
      target.push(part)
    }
  }
}

function appendToolCallsFromSteps(
  target: Record<string, unknown>[],
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const step of value) target.push(...collectToolCalls(step))
    return
  }
  if (!isRecord(value)) return
  appendToolCallsFromSteps(target, value.messages)
  appendToolCallsFromContent(target, value.content)
}

function isStopConditionTool(toolName: string | undefined): boolean {
  return toolName === 'askUserQuestion' || toolName === 'suggestModeSwitch'
}

function markObservedToolRequest(toolCallId: string): boolean {
  if (observedConvexToolRequestIds.size > MAX_OBSERVED_TOOL_CALL_IDS)
    observedConvexToolRequestIds.clear()
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

function emitToolRequestArtifact(
  toolName: string | undefined,
  toolCallId: string,
  args: unknown,
): void {
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

function emitToolArgsArtifact(
  toolName: string | undefined,
  toolCallId: string,
  args: unknown,
): void {
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
  linkActiveSpanToArtifact('consumed', artifactId)
}

function emitToolResultArtifact(
  toolName: string | undefined,
  toolCallId: string,
  result: unknown,
): void {
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
