import { observe } from '@use-crux/core/observability'

/**
 * Tool-call evidence observed while an external AI SDK agent framework drives
 * the actual tool loop outside Crux's own tool lifecycle.
 */
export interface AgentToolCallObservation {
  readonly id?: string
  readonly name: string
  readonly args?: unknown
  readonly traceId: string
}

/**
 * Tool-result evidence inferred from a follow-up model step that contains
 * tool results from the previous agent framework step.
 */
export interface AgentToolEndObservation extends AgentToolCallObservation {
  readonly durationMs: number
  readonly result?: unknown
  readonly modelOutputType?: string
  readonly estimated?: boolean
}

/**
 * Attach a model-emitted tool call to the active Crux observability span.
 *
 * External agent frameworks execute the real tool lifecycle themselves, so the
 * canonical graph records this as step evidence rather than pretending Crux
 * opened and closed the tool span directly.
 */
export function observeAgentToolCall(call: AgentToolCallObservation): void {
  observe.event({
    name: 'tool.call.detected',
    attributes: {
      toolName: call.name,
      traceId: call.traceId,
      ...(call.id ? { toolCallId: call.id } : {}),
    },
  })

  if (call.args !== undefined) {
    observe.artifact({
      kind: 'tool.args',
      contentType: 'application/json',
      encoding: 'json',
      preview: call.args,
      attributes: {
        toolName: call.name,
        traceId: call.traceId,
        ...(call.id ? { toolCallId: call.id } : {}),
        source: 'external-agent',
      },
    })
  }
}

/** Attach an inferred external-agent tool completion to the active span. */
export function observeEstimatedAgentToolEnd(call: AgentToolEndObservation): void {
  observe.event({
    name: 'tool.call.estimated_end',
    attributes: {
      toolName: call.name,
      traceId: call.traceId,
      durationMs: call.durationMs,
      estimated: call.estimated ?? true,
      ...(call.id ? { toolCallId: call.id } : {}),
      ...(call.modelOutputType ? { modelOutputType: call.modelOutputType } : {}),
    },
  })

  if (call.result !== undefined) {
    observe.artifact({
      kind: 'tool.result',
      contentType: 'application/json',
      encoding: 'json',
      preview: call.result,
      attributes: {
        toolName: call.name,
        traceId: call.traceId,
        estimated: call.estimated ?? true,
        ...(call.id ? { toolCallId: call.id } : {}),
      },
    })
  }
}

/** Record that skill instructions were injected into a follow-up model step. */
export function observeSkillInstructionInjected(skillId: string): void {
  observe.event({
    name: 'skill.injected',
    attributes: { skillId },
  })
}
