/**
 * Validate and normalize media-classifier authoring options.
 *
 * @module
 */

import { SafetyConfigError } from '../../../errors'
import type {
  MediaClassifierAction,
  MediaClassifierCategory,
  MediaClassifierCategories,
  MediaClassifierModality,
  MediaClassifierOptions,
  MediaClassifierUnsupportedAction,
  NormalizedMediaClassifierConfig,
  NormalizedMediaClassifierCategory,
  NormalizedMediaClassifierUnsupported,
} from './types'

const CATEGORY_ID = /^[a-z][a-z0-9._-]{0,63}$/
const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const OPTION_FIELDS = [
  'generate',
  'model',
  'categories',
  'threshold',
  'thresholds',
  'action',
  'modalities',
  'unsupported',
] as const
const CATEGORY_FIELDS = ['id', 'description'] as const
const DEFAULT_MODALITIES = [
  'image',
  'audio',
  'video',
  'file',
] as const satisfies readonly MediaClassifierModality[]

/** Normalize JavaScript classifier options into detached, frozen config. */
export function normalizeMediaClassifierConfig(
  options: MediaClassifierOptions<MediaClassifierCategories>,
): NormalizedMediaClassifierConfig {
  if (
    !isRecord(options) ||
    !Array.isArray(options.categories) ||
    options.categories.length === 0
  ) {
    throw configError('categories must contain at least one category.')
  }
  rejectUnknownFields(options, '', OPTION_FIELDS)

  const categories = normalizeCategories(options.categories)
  const threshold = normalizeThreshold(options.threshold, 'threshold')
  const thresholds = normalizeThresholdMap(
    options.thresholds,
    new Set(categories.map((category) => category.id)),
  )
  const modalities = normalizeModalities(options.modalities)
  const action = normalizeAction(options.action)
  const unsupported = normalizeUnsupported(options.unsupported)
  const strategyConfig = Object.freeze({
    categoryIds: Object.freeze(categories.map((category) => category.id)),
    threshold,
    thresholds,
    action,
    modalities,
    unsupported,
  })

  return Object.freeze({
    generate: options.generate,
    model: options.model,
    categories,
    threshold,
    thresholds,
    action,
    modalities,
    unsupported,
    strategyConfig,
  })
}

function normalizeAction(value: unknown): MediaClassifierAction {
  if (value === undefined) return 'block'
  if (value === 'warn' || value === 'block' || value === 'strip') return value
  throw configError('action must be "warn", "block", or "strip".')
}

function normalizeUnsupported(
  value: unknown,
): NormalizedMediaClassifierUnsupported {
  if (value === undefined) return 'throw'
  if (isMediaClassifierUnsupportedAction(value)) return value
  throw configError(
    'unsupported must be "allow", "warn", "block", or "strip".',
  )
}

function isMediaClassifierUnsupportedAction(
  value: unknown,
): value is MediaClassifierUnsupportedAction {
  return (
    value === 'allow' ||
    value === 'warn' ||
    value === 'block' ||
    value === 'strip'
  )
}

function normalizeModalities(
  value: unknown,
): readonly MediaClassifierModality[] {
  if (value === undefined) return Object.freeze([...DEFAULT_MODALITIES])
  if (!Array.isArray(value) || value.length === 0) {
    throw configError('modalities must contain at least one modality.')
  }
  const modalities: MediaClassifierModality[] = []
  const seen = new Set<MediaClassifierModality>()
  for (const modality of value) {
    if (!isMediaClassifierModality(modality)) {
      throw configError(
        'modalities must contain only image, audio, video, or file.',
      )
    }
    if (seen.has(modality)) {
      throw configError('modalities must be unique.')
    }
    seen.add(modality)
    modalities.push(modality)
  }
  return Object.freeze(modalities)
}

function isMediaClassifierModality(
  value: unknown,
): value is MediaClassifierModality {
  return (
    value === 'image' ||
    value === 'audio' ||
    value === 'video' ||
    value === 'file'
  )
}

function normalizeThreshold(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw configError(
      `${field} must be a finite number between 0 and 1.`,
    )
  }
  return value
}

function normalizeCategories(
  categories: readonly MediaClassifierCategory[],
): readonly NormalizedMediaClassifierCategory[] {
  const ids = new Set<string>()
  return Object.freeze(categories.map((category) => {
    if (!isRecord(category) || typeof category.id !== 'string') {
      throw invalidCategoryId()
    }
    rejectUnknownFields(category, 'categories.', CATEGORY_FIELDS)
    assertSafeKey(category.id)
    if (!CATEGORY_ID.test(category.id)) throw invalidCategoryId()
    if (ids.has(category.id)) {
      throw configError('category IDs must be unique.')
    }
    ids.add(category.id)
    if (
      typeof category.description !== 'string' ||
      category.description.trim() === ''
    ) {
      throw configError('category descriptions must contain non-whitespace text.')
    }
    return Object.freeze({
      id: category.id,
      description: category.description.trim(),
    })
  }))
}

function invalidCategoryId(): SafetyConfigError {
  return configError(
    'category IDs must match ^[a-z][a-z0-9._-]{0,63}$.',
  )
}

function normalizeThresholdMap(
  thresholds: unknown,
  categoryIds: ReadonlySet<string>,
): Readonly<Record<string, number>> {
  const normalized = Object.create(null) as Record<string, number>
  if (thresholds !== undefined) {
    if (!isRecord(thresholds)) {
      throw configError('thresholds must be an object.')
    }
    for (const [id, threshold] of Object.entries(thresholds)) {
      assertSafeKey(id)
      if (!categoryIds.has(id)) {
        throw configError(
          `threshold override "${id}" has no authored category.`,
        )
      }
      normalized[id] = normalizeThreshold(threshold, `thresholds.${id}`)
    }
  }
  return Object.freeze(normalized)
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  prefix: string,
  supported: readonly string[],
): void {
  for (const field of Object.keys(value)) {
    assertSafeKey(field)
    if (!supported.includes(field)) {
      throw configError(`${prefix}${field} is not supported.`)
    }
  }
}

function assertSafeKey(key: string): void {
  if (HOSTILE_KEYS.has(key)) {
    throw configError(`unsafe object key "${key}" is not allowed.`)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function configError(problem: string): SafetyConfigError {
  return new SafetyConfigError({
    message: `guardrail.mediaClassifier() configuration is invalid: ${problem}`,
  })
}
