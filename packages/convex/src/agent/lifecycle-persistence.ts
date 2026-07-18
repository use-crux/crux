import type { ResolvedPrompt } from '@use-crux/core'
import type { SkillActivationSession } from '@use-crux/core/skill'
import { observe } from '@use-crux/core/observability'
import { flushObservability } from '../observability'
import type { ConvexAgentContextMessage } from './driver'
import type { ConvexAgentPersistenceConfig } from './lifecycle-types'
import { convexSkillActivationPersistence } from './skill-activation-persistence'
import { isRecord, stringValue } from './lifecycle-utils'
import { trimmedContentProjection } from './message-preview'
import { collectResultToolCalls } from './lifecycle-result-tools'
interface ConvexMemoryDiffSummary {
  readonly before?: unknown
  readonly after?: unknown
  readonly added?: readonly {
    readonly key?: string
    readonly preview: string
  }[]
  readonly removed?: readonly {
    readonly key?: string
    readonly preview: string
  }[]
}
/** Run best-effort skill and memory persistence after a successful agent turn. */
export async function afterPreparedAgentCall(args: {
  readonly resolved: ResolvedPrompt
  readonly input: Record<string, unknown>
  readonly result: unknown
  readonly persistence?: ConvexAgentPersistenceConfig
  readonly captureMessages?: readonly ConvexAgentContextMessage[]
}): Promise<void> {
  if (args.persistence?.skills !== false) {
    await runBestEffortPersistence(
      'persist skills',
      'agent.afterCall.persistSkills',
      () => persistActiveSkills(args.resolved),
    )
  }
  if (args.persistence?.memory !== false) {
    await runBestEffortPersistence(
      'capture memory',
      'agent.afterCall.captureMemory',
      () =>
        captureResolvedMemory(
          args.resolved,
          args.input,
          args.result,
          args.captureMessages,
        ),
    )
  }
}
async function runBestEffortPersistence(
  name: string,
  phase: string,
  fn: () => Promise<ConvexMemoryDiffSummary | undefined>,
): Promise<void> {
  const span = observe.openSpan({
    name,
    primitive: 'memory.write',
    attributes: { phase, bestEffort: true },
  })
  try {
    const summary = await span.withContext(fn)
    emitConvexMemoryDiff(name, phase, summary)
    span.end()
  } catch (error) {
    span.error(error, { phase, errorKind: 'capture_error', bestEffort: true })
  } finally {
    // Best-effort mid-operation capture, not the enclosing action's own
    // terminal drain — a later boundary flush owns reporting real loss.
    await flushObservability({ terminal: false })
  }
}
/** Read active skill ids from the request-scoped Crux store. */
export async function readPersistedSkillIds(): Promise<string[]> {
  const snapshot = await convexSkillActivationPersistence().load({})
  return snapshot?.activeSkillIds.filter((item) => item.length > 0) ?? []
}

async function persistActiveSkills(
  resolved: ResolvedPrompt,
): Promise<ConvexMemoryDiffSummary | undefined> {
  const session = readResolvedSkillSession(resolved)
  if (!session) return undefined
  const persistence = convexSkillActivationPersistence()
  const previous = await persistence.load({})
  const previousActiveSkillIds = previous?.activeSkillIds ?? []
  const next = session.snapshot()
  const nextActiveSkillIds = [...next.activeSkillIds]
  await persistence.save({}, next)
  return {
    before: { activeSkillIds: previousActiveSkillIds },
    after: { activeSkillIds: nextActiveSkillIds },
    added: nextActiveSkillIds
      .filter((skillId) => !previousActiveSkillIds.includes(skillId))
      .map((skillId) => ({
        key: skillId,
        preview: `activated skill ${skillId}`,
      })),
    removed: previousActiveSkillIds
      .filter((skillId) => !nextActiveSkillIds.includes(skillId))
      .map((skillId) => ({
        key: skillId,
        preview: `deactivated skill ${skillId}`,
      })),
  }
}

/** Read the explicit skill session attached by the prompt resolver. */
function readResolvedSkillSession(
  resolved: ResolvedPrompt,
): SkillActivationSession | undefined {
  const candidate = resolved as ResolvedPrompt & {
    readonly _skillSession?: SkillActivationSession
  }
  return candidate._skillSession
}

async function captureResolvedMemory(
  resolved: ResolvedPrompt,
  input: Record<string, unknown>,
  result: unknown,
  captureMessages?: readonly ConvexAgentContextMessage[],
): Promise<ConvexMemoryDiffSummary | undefined> {
  const bindings = resolved.memoryBindings
  if (!bindings || bindings.length === 0) return undefined
  const messages = resolvedMessagesForCapture(resolved, result, captureMessages)
  const toolEvents = collectResultToolCalls(result).map((toolCall) => ({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.args,
    ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
    ...(toolCall.error !== undefined ? { error: toolCall.error } : {}),
  }))
  if (messages.length === 0 && toolEvents.length === 0) return undefined

  await Promise.all(
    bindings.map(async (binding) => {
      await binding.memory.captureTurn(
        {
          messages,
          toolEvents,
          source: { promptId: binding.promptId },
          metadata: { source: 'convex-agent' },
        },
        {
          input: binding.input ?? input,
          promptId: binding.promptId,
        },
      )
      for (const event of toolEvents) {
        await binding.memory.captureToolEvent(event, {
          input: binding.input ?? input,
          promptId: binding.promptId,
        })
      }
      // Convex actions have no waitUntil lifetime; pending capture work must
      // finish before the action returns or the runtime may terminate it.
      await binding.memory.flush({
        input: binding.input ?? input,
        promptId: binding.promptId,
      })
    }),
  )
  return {
    after: {
      bindingCount: bindings.length,
      messageCount: messages.length,
      toolEventCount: toolEvents.length,
      promptIds: bindings
        .map((binding) => binding.promptId)
        .filter((promptId): promptId is string => !!promptId),
    },
    added: [
      ...messages.map((message) => ({
        key: message.role,
        preview: memoryPreviewLine(message).slice(0, 240),
      })),
      ...toolEvents.map((event) => ({
        key: event.toolName,
        preview: `tool:${event.toolName}`,
      })),
    ],
  }
}

function memoryPreviewLine(message: { readonly role: string; readonly content: string }): string {
  return `${message.role}: ${message.content}`
}

function emitConvexMemoryDiff(
  operation: string,
  phase: string,
  summary: ConvexMemoryDiffSummary | undefined,
): void {
  if (!summary) return
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const artifactId = observe.artifact({
    kind: 'memory.diff',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'memory.diff',
      memoryType: 'convex.agent',
      blockKind: 'convex-agent',
      operation,
      phase,
      ...('before' in summary ? { before: summary.before } : {}),
      ...('after' in summary ? { after: summary.after } : {}),
      ...(summary.added
        ? {
            added: summary.added.map((entry) => ({
              blockKind: 'convex-agent',
              ...entry,
            })),
          }
        : {}),
      ...(summary.removed
        ? {
            removed: summary.removed.map((entry) => ({
              blockKind: 'convex-agent',
              ...entry,
            })),
          }
        : {}),
    },
    attributes: {
      memoryType: 'convex.agent',
      blockKind: 'convex-agent',
      operation,
      phase,
      bestEffort: true,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'memory.write',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: {
      memoryType: 'convex.agent',
      blockKind: 'convex-agent',
      operation,
      phase,
    },
  })
}

function resolvedMessagesForCapture(
  resolved: ResolvedPrompt,
  result: unknown,
  captureMessages?: readonly ConvexAgentContextMessage[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  const userText =
    lastUserText(resolved) ?? lastUserTextFromMessages(captureMessages)
  const assistantText = extractAssistantText(result)
  if (userText) messages.push({ role: 'user', content: userText })
  if (assistantText)
    messages.push({ role: 'assistant', content: assistantText })
  return messages
}

function lastUserTextFromMessages(
  messages: readonly ConvexAgentContextMessage[] | undefined,
): string | undefined {
  if (!messages) return undefined
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    const text = trimmedMessageProjection(message.content)
    if (text) return text
  }
  return undefined
}

function lastUserText(resolved: ResolvedPrompt): string | undefined {
  if (resolved.prompt) return resolved.prompt
  const messages = resolved.messages
  if (!Array.isArray(messages)) return undefined
  for (const message of [...messages].reverse()) {
    if (!isRecord(message) || message.role !== 'user') continue
    const text = trimmedMessageProjection(message.content)
    if (text) return text
  }
  return undefined
}

function trimmedMessageProjection(content: unknown): string | undefined {
  return trimmedContentProjection(content)
}

function extractAssistantText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.text === 'string') return value.text
  return extractAssistantTextFromMessages(
    isRecord(value.response) ? value.response.messages : value.messages,
  )
}

function extractAssistantTextFromMessages(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const texts: string[] = []
  for (const message of value) {
    if (!isRecord(message) || message.role !== 'assistant') continue
    const text = trimmedMessageProjection(message.content)
    if (text) texts.push(text)
  }
  return texts.length > 0 ? texts.join('\n') : undefined
}
