/**
 * Media-classifier authoring and normalized configuration contracts.
 *
 * @module
 */

import type { GenerateObjectFn } from '../../../../compaction'
import type { MediaPart } from '../../../boundary'
import type { MediaGuardrailRunResult } from '../../types'

/** One ordered criterion scored independently for every inspected media part. */
export interface MediaClassifierCategory {
  /** Stable identifier used in thresholds, findings, and observability. */
  readonly id: string
  /**
   * Plain-language classification criterion given to the judge.
   *
   * Describe qualifying evidence rather than supplying only a label.
   */
  readonly description: string
}

/** Canonical media kind that can be selected for classifier inspection. */
export type MediaClassifierModality = MediaPart['type']

/** Enforcement action returned when at least one category meets its threshold. */
export type MediaClassifierAction = Exclude<
  MediaGuardrailRunResult['action'],
  'allow'
>

/** Action returned when the classifier adapter cannot inspect a media part. */
export type MediaClassifierUnsupportedAction =
  MediaGuardrailRunResult['action']

/** Non-empty ordered category vocabulary accepted by the classifier. */
export type MediaClassifierCategories = readonly [
  MediaClassifierCategory,
  ...MediaClassifierCategory[],
]

/**
 * Options for classifying canonical image, audio, video, or file parts.
 *
 * @typeParam TCategories - Ordered authored categories whose IDs key
 * per-category threshold overrides.
 */
export type MediaClassifierOptions<
  TCategories extends MediaClassifierCategories,
> = {
  /**
   * Structured generator that receives the selected media.
   *
   * The generator is a separate media-disclosure boundary.
   */
  readonly generate: GenerateObjectFn
  /** Model reference supplied to `generate` for each inspected part. */
  readonly model: unknown
  /** Non-empty ordered classification criteria. */
  readonly categories: TCategories
  /** Required default confidence threshold in the inclusive range `[0, 1]`. */
  readonly threshold: number
  /**
   * Optional confidence thresholds keyed only by authored category IDs.
   *
   * @default {}
   */
  readonly thresholds?: Partial<
    Record<TCategories[number]['id'], number>
  >
  /**
   * Action returned when one or more categories match.
   *
   * @default 'block'
   */
  readonly action?: MediaClassifierAction
  /**
   * Canonical media kinds inspected by the classifier.
   *
   * @default ['image', 'audio', 'video', 'file']
   */
  readonly modalities?: readonly [
    MediaClassifierModality,
    ...MediaClassifierModality[],
  ]
  /**
   * Action returned for a recognized media capability gap.
   *
   * Omission rethrows the exact capability error.
   *
   * @default Throws
   */
  readonly unsupported?: MediaClassifierUnsupportedAction
}

/** Normalized unsupported behavior, including omission as an explicit value. */
export type NormalizedMediaClassifierUnsupported =
  | MediaClassifierUnsupportedAction
  | 'throw'

/** Detached, validated classifier category retained for runtime rubric building. */
export interface NormalizedMediaClassifierCategory {
  readonly id: string
  readonly description: string
}

/**
 * Frozen, JSON-safe classifier config used to build strategy metadata.
 *
 * Prompt version is compiler-owned and added by the Phase 4 strategy factory.
 */
export interface NormalizedMediaClassifierStrategyConfig {
  readonly categoryIds: readonly string[]
  readonly threshold: number
  readonly thresholds: Readonly<Record<string, number>>
  readonly action: MediaClassifierAction
  readonly modalities: readonly MediaClassifierModality[]
  readonly unsupported: NormalizedMediaClassifierUnsupported
}

/** Frozen internal classifier configuration used by runtime evaluation. */
export interface NormalizedMediaClassifierConfig {
  readonly generate: GenerateObjectFn
  readonly model: unknown
  readonly categories: readonly NormalizedMediaClassifierCategory[]
  readonly threshold: number
  readonly thresholds: Readonly<Record<string, number>>
  readonly action: MediaClassifierAction
  readonly modalities: readonly MediaClassifierModality[]
  readonly unsupported: NormalizedMediaClassifierUnsupported
  /** Privacy-safe projection ready for strategy metadata. */
  readonly strategyConfig: NormalizedMediaClassifierStrategyConfig
}
