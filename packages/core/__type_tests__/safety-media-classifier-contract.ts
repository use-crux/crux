/** Public type contract for media-classifier options and media boundaries. */

import { expectTypeOf } from 'vitest'
import type { GenerateObjectFn } from '../src/compaction'
import {
  boundary,
  guardrail,
  type MediaClassifierAction,
  type MediaClassifierCategory,
  type MediaClassifierModality,
  type MediaClassifierOptions,
  type MediaClassifierUnsupportedAction,
  type SafetyTuneOptions,
} from '../src/safety'

declare const generate: GenerateObjectFn

const run = guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [
    { id: 'sexual-content', description: 'Sexual or explicit content.' },
    { id: 'graphic-violence', description: 'Graphic physical injury.' },
  ],
  threshold: 0.8,
  thresholds: {
    'graphic-violence': 0.9,
  },
  modalities: ['image', 'file'],
  unsupported: 'allow',
})

guardrail({ id: 'input-classifier', on: boundary.input.media(), run })
guardrail({ id: 'output-classifier', on: boundary.output.media(), run })
guardrail({
  id: 'input-output-classifier',
  on: [boundary.input.media(), boundary.output.media()] as const,
  run,
})

// @ts-expect-error - categories are required.
guardrail.mediaClassifier({ generate, model: 'classifier-model', threshold: 0.8 })

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  // @ts-expect-error - categories must contain at least one entry.
  categories: [],
  threshold: 0.8,
})

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [{ id: 'known', description: 'Known criterion.' }],
  threshold: 0.8,
  thresholds: {
    known: 0.8,
    // @ts-expect-error - only authored category IDs are accepted.
    unknown: 0.9,
  },
})

const widenedCategories: readonly [
  MediaClassifierCategory,
  ...MediaClassifierCategory[],
] = [{ id: 'runtime-category', description: 'Runtime criterion.' }]

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: widenedCategories,
  threshold: 0.8,
  thresholds: { runtimeCategory: 0.9 },
})

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [{ id: 'known', description: 'Known criterion.' }],
  threshold: 0.8,
  unsupported: 'allow',
})

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [{ id: 'known', description: 'Known criterion.' }],
  threshold: 0.8,
  // @ts-expect-error - matched content cannot be configured to allow.
  action: 'allow',
})

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [{ id: 'known', description: 'Known criterion.' }],
  threshold: 0.8,
  // @ts-expect-error - explicit modalities must be non-empty.
  modalities: [],
})

guardrail.mediaClassifier({
  generate,
  model: 'classifier-model',
  categories: [{ id: 'known', description: 'Known criterion.' }],
  threshold: 0.8,
  // @ts-expect-error - text is not a canonical media modality.
  modalities: ['text'],
})

expectTypeOf<MediaClassifierModality>().toEqualTypeOf<
  'image' | 'audio' | 'video' | 'file'
>()
expectTypeOf<MediaClassifierAction>().toEqualTypeOf<'warn' | 'block' | 'strip'>()
expectTypeOf<MediaClassifierUnsupportedAction>().toEqualTypeOf<
  'allow' | 'warn' | 'block' | 'strip'
>()

guardrail({
  id: 'invalid-text-classifier',
  // @ts-expect-error - media classifiers cannot target text.
  on: boundary.input.text(),
  run,
})

guardrail({
  id: 'invalid-mixed-classifier',
  // @ts-expect-error - media classifiers cannot mix media and text boundaries.
  on: [boundary.input.media(), boundary.output.text()] as const,
  run,
})

const supportedTune = {
  tune: {
    'media-policy': {
      mode: 'report',
      enabled: false,
    },
  },
} satisfies SafetyTuneOptions

expectTypeOf(supportedTune.tune['media-policy']).toEqualTypeOf<{
  mode: 'report'
  enabled: false
}>()

const unsupportedTune = {
  tune: {
    'media-policy': {
      // @ts-expect-error - classifier thresholds are authored policy, not call tuning.
      threshold: 0.9,
    },
  },
} satisfies SafetyTuneOptions

void unsupportedTune

const widenedOptions: MediaClassifierOptions<
  readonly [MediaClassifierCategory, ...MediaClassifierCategory[]]
> = {
  generate,
  model: 'classifier-model',
  categories: widenedCategories,
  threshold: 0.8,
}

guardrail.mediaClassifier(widenedOptions)
