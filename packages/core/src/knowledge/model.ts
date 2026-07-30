/**
 * Named retrieval model binding for connected knowledge.
 *
 * Bind a retrieval model to stable authored identity before using it in
 * persisted knowledge configuration.
 *
 * @module
 */

import type { RetrievalModel } from '../retrieval/model'
import { stableHash } from '../indexing/hash'

/** A named, fingerprinted retrieval model for connected knowledge. */
export interface KnowledgeModel extends RetrievalModel {
  /** Inspectable authored identity. */
  readonly name: string
  /** Captures all output-affecting model configuration. */
  readonly fingerprint: string
}

/** Configuration for {@link knowledgeModel}. */
export type KnowledgeModelConfig = RetrievalModel & {
  readonly name: string
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

  const fingerprint =
    config.fingerprint ?? stableHash({ name: config.name, version: validateVersion(config.version) })

  assertNonEmptyString('Knowledge model fingerprint', fingerprint)

  return Object.freeze({
    name: config.name,
    fingerprint,
    generateText: (args) => config.generateText(args),
    generateObject: (args) => config.generateObject(args),
  } satisfies KnowledgeModel)
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
