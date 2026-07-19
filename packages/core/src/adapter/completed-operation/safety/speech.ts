import type { DataAsset } from '../../../asset/types'
import type { CompletedOperationResult } from '../../../completed-operation/contracts'
import type { MediaPartSubject } from '../../../safety/boundary'
import { freezeSafetyAudit, hasSafetyAudit } from '../../../safety/audit'
import { SafetyResultError } from '../../../safety/errors'
import {
  guardSafetySessionInputOperationText,
  guardSafetySessionOutputMedia,
  type Safety,
} from '../../../safety/session'

type GeneratedSpeechResult = CompletedOperationResult & Readonly<{ readonly audio: DataAsset }>

type SpeechInput = Readonly<{
  readonly text: string
  readonly instructions?: string
}>

/** Guard speech text and optional instructions before provider normalization. */
export async function guardGeneratedSpeechInput<TInput>(input: TInput, safety: Safety): Promise<TInput> {
  if (!isSpeechInput(input)) return input

  const slots = await guardSafetySessionInputOperationText(safety, [
    { boundary: 'user.input', value: input.text },
    ...(input.instructions === undefined ? [] : [{ boundary: 'model.input' as const, value: input.instructions }]),
  ])
  const text = slots[0]?.value ?? input.text
  const instructions = slots[1]?.value ?? input.instructions
  if (text === input.text && instructions === input.instructions) return input

  return Object.freeze({ ...input, text, instructions }) as TInput
}

/** Guard required generated audio and attach canonical Safety audit immutably. */
export async function guardGeneratedSpeechOutput<TResult extends CompletedOperationResult>(
  result: TResult,
  safety: Safety,
  model?: string,
): Promise<TResult> {
  if (!isGeneratedSpeechResult(result)) {
    throw new SafetyResultError({
      message: 'Completed generateSpeech Safety requires a canonical audio result.',
      policyId: 'completed-operation',
      boundary: 'model.output.media',
      problem: 'generateSpeech result has no canonical audio field',
    })
  }

  await guardSafetySessionOutputMedia(safety, [audioSubject(result.audio)], {
    minimumRetained: 1,
    model,
  })
  const audit = safety.audit
  if (!hasSafetyAudit(audit)) return result

  return Object.freeze({
    ...result,
    safety: freezeSafetyAudit(audit),
  })
}

function audioSubject(audio: DataAsset): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: 'audio' as const,
      source: audio,
      mediaType: audio.mediaType,
    }),
    origin: Object.freeze({
      kind: 'operation' as const,
      operation: 'generateSpeech' as const,
      phase: 'output' as const,
      field: 'audio' as const,
      partIndex: 0 as const,
    }),
  })
}

function isGeneratedSpeechResult(result: CompletedOperationResult): result is GeneratedSpeechResult {
  return 'audio' in result
}

function isSpeechInput(value: unknown): value is SpeechInput {
  return typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
}
