import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { CruxRuntime, ToolModelOutput } from '@use-crux/core'
import type { PromptMessage } from './message-shapes'

interface StepTimingEntry {
  lastFlushAt: number
  toolCalls: Array<{ id?: string; name: string; traceId: string }>
}

const stepTimingMap = new Map<string, StepTimingEntry>()
const STEP_TIMING_TTL = 60_000

/** Remove stale step timing entries to prevent long-lived process leaks. */
export function cleanStaleStepTimings(): void {
  const now = Date.now()
  for (const [key, entry] of stepTimingMap) {
    if (now - entry.lastFlushAt > STEP_TIMING_TTL) stepTimingMap.delete(key)
  }
}

/** Remember tool calls so the next model step can estimate tool duration. */
export function recordStepTiming(
  timingKey: string,
  toolCalls: ReadonlyArray<{ id?: string; name: string; traceId: string }>,
): void {
  if (toolCalls.length === 0) return
  stepTimingMap.set(timingKey, {
    lastFlushAt: Date.now(),
    toolCalls: [...toolCalls],
  })
}

function collectToolResults(prompt: readonly PromptMessage[] | undefined): Map<string, unknown> {
  const results = new Map<string, unknown>()
  for (const message of prompt ?? []) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part?.type !== 'tool-result' || !part.toolCallId) continue
      const output = part.output
      if (output?.type === 'text' || output?.type === 'json') {
        results.set(part.toolCallId, { modelOutput: output, result: output.value })
      } else if (output?.type === 'execution-denied') {
        results.set(part.toolCallId, {
          modelOutput: output,
          result: { _denied: true, reason: output.reason },
        })
      }
    }
  }
  return results
}

/**
 * Emit estimated tool:end events when an agent framework starts a follow-up
 * model step that includes tool results from the previous model step.
 */
export function emitEstimatedToolEnds(
  params: LanguageModelV3CallOptions,
  timingKey: string,
  instrumentationHooks: CruxRuntime['instrumentationHooks'],
): void {
  if (!instrumentationHooks?.onToolEnd) return

  const prompt = params.prompt as unknown as PromptMessage[] | undefined
  const hasToolResults = prompt?.some((message) => message.role === 'tool')
  if (!hasToolResults) return

  const previous = stepTimingMap.get(timingKey)
  if (!previous) return

  const resultMap = collectToolResults(prompt)
  const estimatedMs = Date.now() - previous.lastFlushAt

  for (const toolCall of previous.toolCalls) {
    const callId = toolCall.id ?? `est_${Date.now()}`
    const shaped = toolCall.id
      ? (resultMap.get(toolCall.id) as { modelOutput?: ToolModelOutput; result?: unknown } | undefined)
      : undefined

    instrumentationHooks.onToolEnd({
      toolCallId: callId,
      toolName: toolCall.name,
      durationMs: estimatedMs,
      result: shaped?.result,
      modelOutput: shaped?.modelOutput,
      modelOutputType: shaped?.modelOutput?.type,
      estimated: true,
      traceId: toolCall.traceId,
    })
  }

  stepTimingMap.delete(timingKey)
}
