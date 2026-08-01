/**
 * Named retrieval model binding for connected knowledge.
 *
 * Bind a retrieval model to stable authored identity before using it in
 * persisted knowledge configuration.
 *
 * @module
 */

import type { z } from 'zod'
import type { RetrievalModel } from '../retrieval/model'
import type { StoredAsset } from '../asset'
import { stableHash } from '../indexing/hash'

/** Modalities a connected knowledge model can cover without text representation. */
export type KnowledgeModality = 'text' | 'image' | 'audio' | 'video'

/** Text or hydrated media evidence supplied to multimodal connected knowledge hooks. */
export type KnowledgeContentPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'media'; readonly mediaType: string; readonly bytesRef: StoredAsset }

/** A named, fingerprinted retrieval model for connected knowledge. */
export interface KnowledgeModel extends RetrievalModel {
  /** Inspectable authored identity. */
  readonly name: string
  /** Captures all output-affecting model configuration. */
  readonly fingerprint: string
  /** Evidence modalities this model can cover. Absent configuration defaults to text only. */
  readonly modalities?: readonly KnowledgeModality[]
  /** Structured generation over mixed text and hydrated media evidence. */
  generateObjectFromParts?<T>(args: {
    readonly system: string
    readonly parts: readonly KnowledgeContentPart[]
    readonly schema: z.ZodType<T>
  }): Promise<{ object: T }>
}

/** Configuration for {@link knowledgeModel}. */
export type KnowledgeModelConfig = RetrievalModel & {
  readonly name: string
  readonly modalities?: readonly KnowledgeModality[]
  readonly generateObjectFromParts?: KnowledgeModel['generateObjectFromParts']
} & (
    | { readonly fingerprint: string; readonly version?: string | number }
    | { readonly version: string | number; readonly fingerprint?: string }
  )

/**
 * Bind a retrieval model to stable connected-knowledge identity.
 *
 * @param config - Retrieval model plus authored identity.
 * @returns The same model contract with required name and fingerprint.
 *
 * @example
 * ```ts
 * const model = knowledgeModel({
 *   name: 'primary-extractor',
 *   version: '2026-07-30',
 *   generateText,
 *   generateObject,
 * })
 * ```
 */
export function knowledgeModel(config: KnowledgeModelConfig): KnowledgeModel {
  assertNonEmptyString('Knowledge model name', config.name)
  const modalities = normalizeModalities(config.modalities)
  if (modalities.some((modality) => modality !== 'text') && typeof config.generateObjectFromParts !== 'function') {
    throw new Error('Knowledge model declaring image, audio, or video modalities requires generateObjectFromParts.')
  }

  const baseFingerprint =
    config.fingerprint ?? stableHash({ name: config.name, version: validateVersion(config.version) })
  const hasPartsHook = typeof config.generateObjectFromParts === 'function'
  const fingerprint = isDefaultCapability(modalities, hasPartsHook)
    ? baseFingerprint
    : stableHash({ baseFingerprint, modalities, generateObjectFromParts: hasPartsHook })

  assertNonEmptyString('Knowledge model fingerprint', fingerprint)

  return Object.freeze({
    name: config.name,
    fingerprint,
    modalities,
    generateText: (args) => config.generateText(args),
    generateObject: (args) => config.generateObject(args),
    ...(config.generateObjectFromParts
      ? { generateObjectFromParts: (args) => config.generateObjectFromParts!(args) }
      : {}),
  } satisfies KnowledgeModel)
}

function normalizeModalities(value: readonly KnowledgeModality[] | undefined): readonly KnowledgeModality[] {
  const source = value ?? ['text']
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('Knowledge model modalities must include text, image, audio, or video.')
  }
  const seen = new Set<KnowledgeModality>()
  const normalized: KnowledgeModality[] = []
  for (const item of source) {
    if (item !== 'text' && item !== 'image' && item !== 'audio' && item !== 'video') {
      throw new Error('Knowledge model modalities must be text, image, audio, or video.')
    }
    if (!seen.has(item)) {
      seen.add(item)
      normalized.push(item)
    }
  }
  return Object.freeze(normalized.sort(compareModalities))
}

function isDefaultCapability(modalities: readonly KnowledgeModality[], hasPartsHook: boolean): boolean {
  return !hasPartsHook && modalities.length === 1 && modalities[0] === 'text'
}

function compareModalities(left: KnowledgeModality, right: KnowledgeModality): number {
  return modalityRank(left) - modalityRank(right)
}

function modalityRank(value: KnowledgeModality): number {
  if (value === 'text') return 0
  if (value === 'image') return 1
  if (value === 'audio') return 2
  return 3
}

function validateVersion(version: string | number | undefined): string | number {
  if (typeof version === 'string') {
    assertNonEmptyString('Knowledge model version', version)
    return version
  }
  if (typeof version === 'number') {
    return version
  }
  throw new Error('Knowledge model requires a version or fingerprint.')
}

function assertNonEmptyString(label: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be non-empty.`)
  }
}
