import type { MediaPartSubject } from '../../../safety/boundary'
import { freezeSafetyAudit, hasSafetyAudit, type SafetyAudit } from '../../../safety/audit'
import type { GuardrailAuditEntry } from '../../../safety/guardrail/types'
import { SafetyResultError } from '../../../safety/errors'
import {
  guardSafetySessionInputOperationMedia,
  guardSafetySessionInputOperationText,
  guardSafetySessionOutputOperationText,
  runSafetySessionOneShotOutputConstraints,
  type Safety,
} from '../../../safety/session'
import type { AudioSource } from '../../../transcription/contracts'
import type { CompletedOperationResult } from '../../../completed-operation/contracts'

type TranscriptionInput = Readonly<{
  readonly audio: AudioSource
  readonly prompt?: string
}>

type CanonicalTranscriptionResult = CompletedOperationResult &
  Readonly<{
    readonly text: string
    readonly segments: readonly unknown[]
    readonly words: readonly unknown[]
  }>

/** Guard required transcription audio before provider normalization or materialization. */
export async function guardTranscriptionInput<TInput>(input: TInput, safety: Safety): Promise<TInput> {
  if (!isTranscriptionInput(input)) return input

  const prepared = await guardPromptHint(input, safety)
  await guardSafetySessionInputOperationMedia(
    safety,
    [{ subject: audioSubject(prepared.audio), groupId: 'audio' }],
    [{ id: 'audio', size: 1, minimumRetained: 1 }],
  )
  return prepared as TInput
}

/** Guard canonical transcript text and attach accumulated Safety audit immutably. */
export async function guardTranscriptionOutput<TResult extends CompletedOperationResult>(
  result: TResult,
  safety: Safety,
  model?: string,
): Promise<TResult> {
  if (!isTranscriptionResult(result)) {
    throw new SafetyResultError({
      message: 'Completed transcribe Safety requires a canonical transcript result.',
      policyId: 'completed-operation',
      boundary: 'model.output.text',
      problem: 'transcribe result has no canonical text or timed-detail arrays',
    })
  }

  const text = await guardSafetySessionOutputOperationText(safety, result.text, model)
  await runSafetySessionOneShotOutputConstraints(safety, text, model)
  const changed = text !== result.text
  const audit = safety.audit
  if (!changed && !hasSafetyAudit(audit)) return result
  const publicAudit = changed ? withTimedTranscriptDetailRemoved(audit) : audit

  return Object.freeze({
    ...result,
    ...(changed ? { text, segments: Object.freeze([]), words: Object.freeze([]) } : {}),
    ...(hasSafetyAudit(publicAudit) ? { safety: freezeSafetyAudit(publicAudit) } : {}),
  })
}

function withTimedTranscriptDetailRemoved(audit: SafetyAudit): SafetyAudit {
  const guardrails = audit.guardrails
  if (!guardrails) return audit
  const index = lastEnforcedTranscriptRewrite(guardrails.applied)
  if (index < 0) return audit

  return {
    ...audit,
    guardrails: {
      ...guardrails,
      applied: guardrails.applied.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, timedTranscriptDetailRemoved: true as const } : entry,
      ),
    },
  }
}

function lastEnforcedTranscriptRewrite(entries: readonly GuardrailAuditEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (
      entry?.boundary === 'model.output.text' &&
      entry.mode === 'enforce' &&
      (entry.action === 'redact' || entry.action === 'transform')
    ) {
      return index
    }
  }
  return -1
}

async function guardPromptHint(input: TranscriptionInput, safety: Safety): Promise<TranscriptionInput> {
  if (input.prompt === undefined) return input

  const [slot] = await guardSafetySessionInputOperationText(safety, [{ boundary: 'user.input', value: input.prompt }])
  if (!slot || slot.value === input.prompt) return input
  return Object.freeze({ ...input, prompt: slot.value })
}

function audioSubject(audio: AudioSource): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: 'audio' as const,
      source: audio,
    }),
    origin: Object.freeze({
      kind: 'operation' as const,
      operation: 'transcribe' as const,
      phase: 'input' as const,
      field: 'audio' as const,
      partIndex: 0 as const,
    }),
  })
}

function isTranscriptionInput(value: unknown): value is TranscriptionInput {
  return typeof value === 'object' && value !== null && 'audio' in value
}

function isTranscriptionResult(result: CompletedOperationResult): result is CanonicalTranscriptionResult {
  return (
    'text' in result &&
    typeof result.text === 'string' &&
    'segments' in result &&
    Array.isArray(result.segments) &&
    'words' in result &&
    Array.isArray(result.words)
  )
}
