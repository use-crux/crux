/** Public Safety options and audit contract for completed image operations. */

import { expectTypeOf } from 'vitest'
import { router } from '../src/routing'
import { type GenerateImage, type GenerateImageOptions, type GenerateImageResult, type SafetyAudit } from '../src'
import { boundary, guardrail } from '../src/safety'

const outputPolicy = guardrail({
  id: 'generated-image-policy',
  on: boundary.output.media(),
  run: () => ({ action: 'allow' }),
})

const directOptions = {
  model: 'image-model',
  prompt: 'A quiet canal',
  guardrails: [outputPolicy],
  safety: { tune: { 'generated-image-policy': { mode: 'report' } } },
} satisfies GenerateImageOptions<'image-model'>
void directOptions

const invalidConstraints = {
  model: 'image-model',
  prompt: 'A quiet canal',
  // @ts-expect-error - image operations do not expose output constraints.
  constraints: [],
} satisfies GenerateImageOptions<'image-model'>
void invalidConstraints

const invalidConstraintRetries = {
  model: 'image-model',
  prompt: 'A quiet canal',
  // @ts-expect-error - completed image operations never retry constraints.
  constraintMaxRetries: 1,
} satisfies GenerateImageOptions<'image-model'>
void invalidConstraintRetries

declare const generateImage: GenerateImage<'image-model'>

void generateImage({
  model: router({
    classify: () => 'only' as const,
    routes: { only: 'image-model', default: 'image-model' },
  }),
  prompt: 'A quiet canal',
  guardrails: [outputPolicy],
  safety: { tune: { 'generated-image-policy': { enabled: true } } },
})

declare const result: GenerateImageResult
expectTypeOf(result.safety).toEqualTypeOf<SafetyAudit | undefined>()
