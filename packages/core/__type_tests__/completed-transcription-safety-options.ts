/** Public Safety options for completed transcription operations. */

import type { SafetyAudit, Transcribe, TranscribeOptions, TranscriptionResult } from '../src'
import { router } from '../src/routing'
import { boundary, constraint, guardrail } from '../src/safety'

const transcriptPolicy = guardrail({
  id: 'transcript-policy',
  on: boundary.output.text(),
  run: () => ({ action: 'allow' }),
})

const transcriptConstraint = constraint({
  id: 'transcript-constraint',
  on: boundary.output.text(),
  run: () => ({ pass: true }),
})

const objectConstraint = constraint({
  id: 'transcription-object-constraint',
  on: boundary.output.object<{ text: string }>(),
  run: () => ({ pass: true }),
})

const directOptions = {
  model: 'transcription-model',
  audio: new Uint8Array([1]),
  guardrails: [transcriptPolicy],
  constraints: [transcriptConstraint],
  safety: { tune: { 'transcript-policy': { mode: 'report' } } },
} satisfies TranscribeOptions<'transcription-model'>
void directOptions

const invalidConstraintRetries = {
  model: 'transcription-model',
  audio: new Uint8Array([1]),
  // @ts-expect-error - transcription constraints are one-shot and cannot retry.
  constraintMaxRetries: 1,
} satisfies TranscribeOptions<'transcription-model'>
void invalidConstraintRetries

const invalidObjectConstraint = {
  model: 'transcription-model',
  audio: new Uint8Array([1]),
  // @ts-expect-error - transcription exposes only canonical transcript text.
  constraints: [objectConstraint],
} satisfies TranscribeOptions<'transcription-model'>
void invalidObjectConstraint

declare const transcribe: Transcribe<'transcription-model'>

void transcribe({
  model: router({
    classify: () => 'only' as const,
    routes: { only: 'transcription-model', default: 'transcription-model' },
  }),
  audio: new Uint8Array([1]),
  guardrails: [transcriptPolicy],
  constraints: [transcriptConstraint],
})

declare const result: TranscriptionResult
result satisfies Readonly<{ safety?: SafetyAudit }>
