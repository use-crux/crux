/** Focused authoring fixtures for media-classifier config tests. */

import type { GenerateObjectFn } from '../../src/generation/support-types'
import { normalizeMediaClassifierConfig } from '../../src/safety/guardrail/strategies/media-classifier/config'
import type {
  MediaClassifierCategories,
  MediaClassifierOptions,
} from '../../src/safety/guardrail/strategies/media-classifier/types'

export const generate: GenerateObjectFn = async () => {
  throw new Error('config tests never call the generator')
}

export function validOptions(): MediaClassifierOptions<MediaClassifierCategories> {
  return {
    generate,
    model: 'classifier-model',
    categories: [
      { id: 'sexual-content', description: 'Sexual or explicit content.' },
      { id: 'graphic-violence', description: 'Graphic physical injury.' },
    ],
    threshold: 0.8,
  }
}

export function normalize(value: unknown) {
  return normalizeMediaClassifierConfig(
    value as MediaClassifierOptions<MediaClassifierCategories>,
  )
}
