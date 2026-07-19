/** Public Safety options for completed speech operations. */

import { expectTypeOf } from 'vitest'
import type { GenerateSpeech, GenerateSpeechOptions, GenerateSpeechResult, SafetyAudit } from '../src'
import { router } from '../src/routing'
import { boundary, guardrail } from '../src/safety'

const outputPolicy = guardrail({
  id: 'generated-speech-policy',
  on: boundary.output.media(),
  run: () => ({ action: 'allow' }),
})

const directOptions = {
  model: 'speech-model',
  text: 'Welcome aboard',
  guardrails: [outputPolicy],
  safety: { tune: { 'generated-speech-policy': { mode: 'report' } } },
} satisfies GenerateSpeechOptions<'speech-model'>
void directOptions

const invalidConstraints = {
  model: 'speech-model',
  text: 'Welcome aboard',
  // @ts-expect-error - speech operations do not expose output constraints.
  constraints: [],
} satisfies GenerateSpeechOptions<'speech-model'>
void invalidConstraints

const invalidConstraintRetries = {
  model: 'speech-model',
  text: 'Welcome aboard',
  // @ts-expect-error - completed speech operations never retry constraints.
  constraintMaxRetries: 1,
} satisfies GenerateSpeechOptions<'speech-model'>
void invalidConstraintRetries

declare const generateSpeech: GenerateSpeech<'speech-model'>

void generateSpeech({
  model: router({
    classify: () => 'only' as const,
    routes: { only: 'speech-model', default: 'speech-model' },
  }),
  text: 'Welcome aboard',
  guardrails: [outputPolicy],
  safety: { tune: { 'generated-speech-policy': { enabled: true } } },
})

declare const result: GenerateSpeechResult
expectTypeOf(result.safety).toEqualTypeOf<SafetyAudit | undefined>()
