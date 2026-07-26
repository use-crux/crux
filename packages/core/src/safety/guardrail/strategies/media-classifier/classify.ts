/** Canonical media disclosure and structured classifier invocation. */

import type { MediaPart } from '../../../boundary'
import type {
  NormalizedMediaClassifierConfig,
  NormalizedMediaClassifierCategory,
} from './types'
import {
  MEDIA_CLASSIFIER_SYSTEM_PROMPT,
  mediaClassifierRubric,
} from './prompt'
import type { MediaClassifierSchema } from './schema'

interface MediaClassifierCallPlan {
  readonly categories: readonly NormalizedMediaClassifierCategory[]
  readonly schema: MediaClassifierSchema
}

/** Classify one canonical media part and validate the returned scores again. */
export async function classifyMediaPart(
  config: NormalizedMediaClassifierConfig,
  plan: MediaClassifierCallPlan,
  part: MediaPart,
): Promise<Readonly<Record<string, number>>> {
  const result = await config.generate({
    model: config.model,
    system: MEDIA_CLASSIFIER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: mediaClassifierRubric(plan.categories) },
          sanitizedMediaPart(part),
        ],
      },
    ],
    schema: plan.schema,
  })
  return plan.schema.parse(result.object).scores
}

function sanitizedMediaPart(part: MediaPart): MediaPart {
  switch (part.type) {
    case 'image':
    case 'audio':
    case 'video':
      return {
        type: part.type,
        source: part.source,
        ...(part.mediaType === undefined ? {} : { mediaType: part.mediaType }),
      }
    case 'file':
      return {
        type: 'file',
        source: part.source,
        ...(part.mediaType === undefined ? {} : { mediaType: part.mediaType }),
        ...(part.filename === undefined ? {} : { filename: part.filename }),
      }
  }
}
