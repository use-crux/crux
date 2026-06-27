import type { ResolvedPrompt } from '@use-crux/core'
import type { SkillActivationSession } from '@use-crux/core/skill'
import { observe } from '@use-crux/core/observability'
import { flushObservability } from '../observability'
import type { ConvexAgentContextMessage } from './driver'
import { convexSkillActivationPersistence } from './skill-activation-persistence'
import { isRecord, stringValue } from './lifecycle-utils'

interface ConvexMemoryDiffSummary {
  readonly before?: unknown
  readonly after?: unknown
  readonly added?: readonly { readonly key?: string; readonly preview: string }[]
  readonly removed?: readonly { readonly key?: string; readonly preview: string }[]
}

/** Run best-effort skill and memory persistence after a successful agent turn. */
export async function afterPreparedAgentCall(args: {
  readonly resolved: ResolvedPrompt
  readonly input: Record<string, unknown>
  readonly result: unknown
  readonly captureMessages?: readonly ConvexAgentContextMessage[]
}): Promise<void> {
  await runBestEffortPersistence('persist skills', 'agent.afterCall.persistSkills', () =>
    persistActiveSkills(args.resolved),
  )
  await runBestEffortPersistence('capture memory', 'agent.afterCall.captureMemory', () =>
    captureResolvedMemory(args.resolved, args.input, args.result, args.captureMessages),
  )
}

async function runBestEffortPersistence(
  name: string,
  phase: string,
  fn: () => Promise<ConvexMemoryDiffSummary | undefined>,
): Promise<void> {
  const span = observe.openSpan({
    name,
    family: 'memory',
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
    await flushObservability()
  }
}

/** Read active skill ids from the request-scoped Crux store. */
export async function readPersistedSkillIds(): Promise<string[]> {
  const snapshot = await convexSkillActivationPersistence().load({})
  return snapshot?.activeSkillIds.filter((item) => item.length > 0) ?? []
}

async function persistActiveSkills(resolved: ResolvedPrompt): Promise<ConvexMemoryDiffSummary | undefined> {
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
      .map((skillId) => ({ key: skillId, preview: `activated skill ${skillId}` })),
    removed: previousActiveSkillIds
      .filter((skillId) => !nextActiveSkillIds.includes(skillId))
      .map((skillId) => ({ key: skillId, preview: `deactivated skill ${skillId}` })),
  }
}

/** Read the explicit skill session attached by the prompt resolver. */
function readResolvedSkillSession(resolved: ResolvedPrompt): SkillActivationSession | undefined {
  const candidate = resolved as ResolvedPrompt & { readonly _skillSession?: SkillActivationSession }
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
      promptIds: bindings.map((binding) => binding.promptId).filter((promptId): promptId is string => !!promptId),
    },
    added: [
      ...messages.map((message) => ({
        key: message.role,
        preview: `${message.role}: ${message.content}`.slice(0, 240),
      })),
      ...toolEvents.map((event) => ({
        key: event.toolName,
        preview: `tool:${event.toolName}`,
      })),
    ],
  }
}

function emitConvexMemoryDiff(operation: string, phase: string, summary: ConvexMemoryDiffSummary | undefined): void {
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
      ...(summary.added ? { added: summary.added.map((entry) => ({ blockKind: 'convex-agent', ...entry })) } : {}),
      ...(summary.removed
        ? { removed: summary.removed.map((entry) => ({ blockKind: 'convex-agent', ...entry })) }
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
    attributes: { memoryType: 'convex.agent', blockKind: 'convex-agent', operation, phase },
  })
}

function resolvedMessagesForCapture(
  resolved: ResolvedPrompt,
  result: unknown,
  captureMessages?: readonly ConvexAgentContextMessage[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  const userText = lastUserText(resolved) ?? lastUserTextFromMessages(captureMessages)
  const assistantText = extractAssistantText(result)
  if (userText) messages.push({ role: 'user', content: userText })
  if (assistantText) messages.push({ role: 'assistant', content: assistantText })
  return messages
}

function lastUserTextFromMessages(messages: readonly ConvexAgentContextMessage[] | undefined): string | undefined {
  if (!messages) return undefined
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    const text = messageContentText(message.content)
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
    const text = messageContentText(message.content)
    if (text) return text
  }
  return undefined
}

function messageContentText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const text = content.trim()
    return text ? text : undefined
  }
  if (!Array.isArray(content)) return undefined

  const parts: string[] = []
  for (const part of content) {
    if (isRecord(part) && typeof part.text === 'string') parts.push(part.text)
  }

  const text = parts.join('').trim()
  return text ? text : undefined
}

function extractAssistantText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.text === 'string') return value.text
  return extractAssistantTextFromMessages(isRecord(value.response) ? value.response.messages : value.messages)
}

function extractAssistantTextFromMessages(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const texts: string[] = []
  for (const message of value) {
    if (!isRecord(message) || message.role !== 'assistant') continue
    if (typeof message.content === 'string') {
      texts.push(message.content)
      continue
    }
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (isRecord(part) && typeof part.text === 'string') texts.push(part.text)
    }
  }
  return texts.length > 0 ? texts.join('') : undefined
}

function collectResultToolCalls(value: unknown): Array<{ id?: string; name: string; args: unknown }> {
  const calls: Array<{ id?: string; name: string; args: unknown }> = []
  appendResultToolCalls(calls, value)
  return calls
}

function appendResultToolCalls(target: Array<{ id?: string; name: string; args: unknown }>, value: unknown): void {
  if (!value) return
  if (Array.isArray(value)) {
    for (const item of value) appendResultToolCalls(target, item)
    return
  }
  if (!isRecord(value)) return
  const name = stringValue(value.toolName) ?? stringValue(value.name)
  if (name) {
    target.push({
      id: stringValue(value.toolCallId) ?? stringValue(value.id),
      name,
      args: value.args ?? value.input ?? value.arguments,
    })
  }
  appendResultToolCalls(target, value.toolCalls)
  appendResultToolCalls(target, value.steps)
}
