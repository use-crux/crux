import type { Message } from '../../generation/messages'
import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import type { MediaPartLocation, MediaPartSubject } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { safeCaptureSummary } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import {
  recordMediaGuardrailBlockedEdge,
  recordMediaGuardrailReport,
} from '../guardrail/observability'
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
  MediaGuardrailRunResult,
} from '../guardrail/types'
import { validateMediaGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'

interface GuardInputMediaOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly messages: readonly Message[]
  readonly context: (messages: readonly Message[]) => GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

export interface MediaInputResult {
  readonly messages: readonly Message[]
  readonly actions: readonly string[]
  readonly ran: boolean
}

/** Visit canonical user media in original order without provider projection. */
export async function guardInputMedia(options: GuardInputMediaOptions): Promise<MediaInputResult> {
  if (options.bindings.length === 0) {
    return { messages: options.messages, actions: [], ran: false }
  }

  const actions: string[] = []
  const stripped = new Set<string>()
  let messages = options.messages
  let ran = false

  for (let messageIndex = 0; messageIndex < options.messages.length; messageIndex++) {
    const message = options.messages[messageIndex]
    if (!message || message.role !== 'user' || typeof message.content === 'string') continue

    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex]
      if (!part || part.type === 'text') continue

      for (const binding of options.bindings) {
        ran = true
        const start = performance.now()
        const subject: MediaPartSubject = { part, messageIndex, partIndex }
        const location: MediaPartLocation = {
          messageIndex,
          partIndex,
          partType: part.type,
        }
        const context = options.context(messages)
        const span = observe.openSpan({
          name: binding.policy.id,
          primitive: 'guardrail.run',
          definitionRefs: [guardrailDefinitionRef(binding.policy.id)],
          attributes: {
            guardrailName: binding.policy.id,
            category: binding.policy.category,
            boundary: binding.boundary.id,
            mode: binding.mode,
            phase: 'input',
            promptId: context.promptId,
            model: context.model,
            mediaPartType: location.partType,
            messageIndex: location.messageIndex,
            partIndex: location.partIndex,
          },
        })
        let result: MediaGuardrailRunResult
        try {
          const value: unknown = await span.withContext(() =>
            binding.policy.run(
              subject as never,
              mediaRunContext(binding, context) as never,
            ),
          )
          result = validateMediaGuardrailRunResult(value, {
            policyId: binding.policy.id,
            boundary: binding.boundary.id,
          })
        } catch (error) {
          span.error(error)
          throw error
        }
        const escalatedToBlock =
          result.action === 'strip' &&
          binding.mode === 'enforce' &&
          stripWouldEmptyMessage(message.content, messageIndex, partIndex, stripped)
        const durationMs = performance.now() - start
        span.withContext(() =>
          recordMediaGuardrailReport(binding, result, location, durationMs, escalatedToBlock),
        )
        span.end({ attributes: { action: result.action, durationMs } })
        const entry: GuardrailAuditEntry = {
          guard: binding.policy.id,
          ...(binding.policy.category !== undefined ? { category: binding.policy.category } : {}),
          boundary: binding.boundary.id,
          mode: binding.mode,
          phase: 'input',
          action: result.action,
          ...(result.action === 'warn' || result.action === 'block' || result.action === 'strip'
            ? { reason: result.reason }
            : {}),
          location,
          ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
          durationMs,
        }
        actions.push(entry.action)
        options.appendAudit({
          applied: [entry],
          blocked: (result.action === 'block' && binding.mode === 'enforce') || escalatedToBlock,
        })

        if (result.action === 'block' && binding.mode === 'enforce') {
          span.withContext(() =>
            recordMediaGuardrailBlockedEdge(binding, result.reason, location, false),
          )
          throw new GuardrailBlockedError({
            guardrailId: binding.policy.id,
            phase: 'input',
            reason: result.reason,
            decisions: [
              {
                policyId: binding.policy.id,
                kind: 'guardrail',
                boundary: binding.boundary.id,
                mode: binding.mode,
                action: 'block',
                reason: result.reason,
                location,
                ...(binding.tuned ? { tuned: binding.tuned } : {}),
                durationMs: entry.durationMs,
                captured: safeCaptureSummary(''),
              },
            ],
          })
        }

        if (result.action === 'strip' && binding.mode === 'enforce') {
          if (escalatedToBlock) {
            span.withContext(() =>
              recordMediaGuardrailBlockedEdge(binding, result.reason, location, true),
            )
            throw new GuardrailBlockedError({
              guardrailId: binding.policy.id,
              phase: 'input',
              reason: result.reason,
              decisions: [
                {
                  policyId: binding.policy.id,
                  kind: 'guardrail',
                  boundary: binding.boundary.id,
                  mode: binding.mode,
                  action: 'block',
                  reason: result.reason,
                  location,
                  ...(binding.tuned ? { tuned: binding.tuned } : {}),
                  durationMs: entry.durationMs,
                  captured: safeCaptureSummary(''),
                },
              ],
            })
          }
          stripped.add(coordinateKey(messageIndex, partIndex))
          messages = rebuildStrippedMessage(options.messages, messages, messageIndex, stripped)
          break
        }
      }
    }
  }

  return {
    messages,
    actions,
    ran,
  }
}

function stripWouldEmptyMessage(
  content: readonly { readonly type: string }[],
  messageIndex: number,
  partIndex: number,
  stripped: ReadonlySet<string>,
): boolean {
  return content.every(
    (_part, originalPartIndex) =>
      originalPartIndex === partIndex || stripped.has(coordinateKey(messageIndex, originalPartIndex)),
  )
}

function rebuildStrippedMessage(
  originalMessages: readonly Message[],
  currentMessages: readonly Message[],
  messageIndex: number,
  stripped: ReadonlySet<string>,
): readonly Message[] {
  const original = originalMessages[messageIndex]
  if (!original || original.role !== 'user' || typeof original.content === 'string') return currentMessages

  const content = original.content.filter((_part, partIndex) => !stripped.has(coordinateKey(messageIndex, partIndex)))
  return currentMessages.map((message, index) => (index === messageIndex ? { ...original, content } : message))
}

function coordinateKey(messageIndex: number, partIndex: number): string {
  return `${messageIndex}:${partIndex}`
}

function mediaRunContext(binding: GuardrailBinding, context: GuardrailContext): SafetyRunContext {
  return {
    policy: { id: binding.policy.id, mode: binding.mode },
    boundary: { id: binding.boundary.id, kind: binding.boundary.id },
    prompt: { id: context.promptId },
    model: { id: context.model },
    trace: { id: context.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: context.metadata,
    findings: { add() {} },
  }
}
