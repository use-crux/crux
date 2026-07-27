/**
 * Structured media-classifier guardrail strategy.
 *
 * @module
 */

import type { ZodError } from 'zod'
import {
  isUnsupportedCapabilityError,
  type UnsupportedCapabilityError,
} from '../../../../content/media-errors'
import type {
  BoundaryDef,
  MediaPartSubject,
  MediaSafetyTargetId,
} from '../../../boundary'
import type { SafetyConfigError } from '../../../errors'
import type { GuardrailRun, MediaGuardrailRunResult } from '../../types'
import { classifyMediaPart } from './classify'
import { normalizeMediaClassifierConfig } from './config'
import { evaluateMediaClassifierScores } from './evaluate'
import { MEDIA_CLASSIFIER_PROMPT_VERSION } from './prompt'
import { mediaClassifierSchema } from './schema'
import { handleUnsupportedMedia } from './unsupported'
import type {
  MediaClassifierCategories,
  MediaClassifierOptions,
} from './types'

type MediaBoundaryDef = BoundaryDef<MediaSafetyTargetId, MediaPartSubject>
type MediaBoundary =
  | MediaBoundaryDef
  | readonly [MediaBoundaryDef, ...MediaBoundaryDef[]]

/**
 * Create a guardrail body that classifies each selected media part.
 *
 * @remarks
 * The returned body attaches only to input/output {@link MediaSafetyTargetId
 * media boundaries}. The configured generator is a separate disclosure
 * boundary: it receives the selected canonical image, audio, video, or
 * file/document. A modality excluded by `modalities` returns `allow` without a
 * call. Included media that the adapter or model cannot inspect follows the
 * `unsupported` policy.
 *
 * An adapter-backed generator created with
 * `createGenerateObjectFnFromGenerate()` executes its full prompt lifecycle.
 * Attaching this guardrail to that same lifecycle recurses.
 *
 * @param options - Generator, model, ordered categories, thresholds, and media policy.
 * @returns A guardrail callback restricted to input/output media boundaries.
 *
 * @throws {@link SafetyConfigError} when the authored configuration is invalid.
 * @throws {@link UnsupportedCapabilityError} when included media is unsupported
 * and `unsupported` is omitted.
 * @throws {@link ZodError} when the classifier response is not the exact
 * category-keyed score object. Provider, authentication, rate-limit,
 * transport, timeout, abort, and other generator errors propagate unchanged.
 *
 * @example
 * ```ts
 * const inputMedia = guardrail({
 *   id: 'input-media',
 *   on: boundary.input.media(),
 *   run: guardrail.mediaClassifier({
 *     generate,
 *     model: 'classifier-model',
 *     categories: [{ id: 'unsafe', description: 'Unsafe media content.' }],
 *     threshold: 0.8,
 *   }),
 * })
 * ```
 *
 * @example
 * ```ts
 * const reportOutputMedia = guardrail({
 *   id: 'output-media-report',
 *   on: boundary.output.media(),
 *   mode: 'report',
 *   run: guardrail.mediaClassifier({
 *     generate,
 *     model: 'classifier-model',
 *     categories: [{ id: 'unsafe', description: 'Unsafe generated media.' }],
 *     threshold: 0.8,
 *     modalities: ['image', 'file'],
 *     unsupported: 'warn',
 *   }),
 * })
 * ```
 */
export function mediaClassifier<
  const TCategories extends MediaClassifierCategories,
>(
  options: MediaClassifierOptions<TCategories>,
): GuardrailRun<MediaBoundary> {
  const config = normalizeMediaClassifierConfig(options)
  const plan = {
    categories: config.categories,
    schema: mediaClassifierSchema(config.categories),
  }
  const run = async (
    subject: MediaPartSubject,
    ctx: Parameters<GuardrailRun<MediaBoundary>>[1],
  ): Promise<MediaGuardrailRunResult> => {
    if (!config.modalities.includes(subject.part.type)) {
      return { action: 'allow' }
    }
    try {
      const scores = await classifyMediaPart(config, plan, subject.part)
      return evaluateMediaClassifierScores(config, scores, ctx)
    } catch (error) {
      if (
        !isUnsupportedCapabilityError(error) ||
        config.unsupported === 'throw'
      ) {
        throw error
      }
      return handleUnsupportedMedia(config.unsupported, error, ctx)
    }
  }
  return Object.assign(run, {
    strategy: Object.freeze({
      kind: 'guardrail.mediaClassifier',
      config: Object.freeze({
        ...config.strategyConfig,
        promptVersion: MEDIA_CLASSIFIER_PROMPT_VERSION,
      }),
    }),
  })
}

export { MEDIA_CLASSIFIER_PROMPT_VERSION } from './prompt'
export type {
  MediaClassifierAction,
  MediaClassifierCategory,
  MediaClassifierModality,
  MediaClassifierOptions,
  MediaClassifierUnsupportedAction,
} from './types'
