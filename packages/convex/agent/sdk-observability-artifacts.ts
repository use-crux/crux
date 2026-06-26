import { observe } from '@crux/core/observability'
import { stringValue } from './lifecycle-utils'
import { numericValue } from './sdk-observability-values'

/** Emit a messages artifact for Convex Agent call args or fetched thread context. */
export function emitConvexAgentMessagesArtifact(
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

/** Emit text/content artifacts reported by one Convex Agent step. */
export function emitStepOutputArtifacts(step: unknown): void {
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

export function linkActiveSpanToArtifact(
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
