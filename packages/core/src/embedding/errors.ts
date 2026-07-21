/**
 * Public errors raised by embedding input and vector-space guards.
 *
 * Errors expose stable structured fields for programmatic handling while their
 * messages identify the failed invariant and an actionable recovery.
 *
 * @module
 */

import type { EmbeddingModality } from './modality'

/** Thrown before provider I/O when an embedding cannot encode an input modality. */
export class EmbeddingModalityError extends Error {
  /** Embedding configuration that rejected the input. */
  readonly embeddingName: string
  /** Input modality that the embedding cannot encode. */
  readonly modality: EmbeddingModality
  /** Modalities declared by the embedding. */
  readonly supported: readonly EmbeddingModality[]

  /**
   * Create an actionable unsupported-modality error.
   *
   * @param options - Embedding identity, rejected modality, and supported modalities.
   */
  constructor(options: {
    readonly embeddingName: string
    readonly modality: EmbeddingModality
    readonly supported: readonly EmbeddingModality[]
  }) {
    super(modalityMessage(options))
    this.name = 'EmbeddingModalityError'
    this.embeddingName = options.embeddingName
    this.modality = options.modality
    this.supported = Object.freeze([...options.supported])
  }
}

/** Human-readable dense vector-space facts used in mismatch messages. */
export interface EmbeddingSpaceDescriptor {
  /** Embedding model or authored embedding name. */
  readonly name: string
  /** Dense vector dimensionality. */
  readonly dimensions: number
}

/** Thrown when indexing or retrieval would compare incompatible dense spaces. */
export class EmbeddingSpaceMismatchError extends Error {
  /** Namespace whose stored and configured spaces disagree. */
  readonly namespace: string
  /** SHA-256 digest recorded for the namespace. */
  readonly expected: string
  /** SHA-256 digest derived from the configured embedding. */
  readonly actual: string
  /** Stored space facts, when a namespace record is available. */
  readonly expectedSpace?: EmbeddingSpaceDescriptor
  /** Configured embedding facts, when available. */
  readonly actualSpace?: EmbeddingSpaceDescriptor

  /**
   * Create an actionable vector-space mismatch error.
   *
   * @param options - Namespace, digests, and optional human-readable space facts.
   */
  constructor(options: {
    readonly namespace: string
    readonly expected: string
    readonly actual: string
    readonly expectedSpace?: EmbeddingSpaceDescriptor
    readonly actualSpace?: EmbeddingSpaceDescriptor
  }) {
    super(spaceMismatchMessage(options))
    this.name = 'EmbeddingSpaceMismatchError'
    this.namespace = options.namespace
    this.expected = options.expected
    this.actual = options.actual
    this.expectedSpace = options.expectedSpace
    this.actualSpace = options.actualSpace
  }
}

function modalityMessage(options: {
  readonly embeddingName: string
  readonly modality: EmbeddingModality
  readonly supported: readonly EmbeddingModality[]
}): string {
  const accepted = options.supported.length === 1
    ? `${options.supported[0]} only`
    : options.supported.join(', ')
  return `Embedding "${options.embeddingName}" accepts ${accepted}; ${options.modality} input requires a multimodal embedding model such as Google "gemini-embedding-2".`
}

function spaceMismatchMessage(options: {
  readonly namespace: string
  readonly expected: string
  readonly actual: string
  readonly expectedSpace?: EmbeddingSpaceDescriptor
  readonly actualSpace?: EmbeddingSpaceDescriptor
}): string {
  const expected = options.expectedSpace
    ? `"${options.expectedSpace.name}" (${options.expectedSpace.dimensions}d)`
    : `space ${options.expected}`
  const actual = options.actualSpace
    ? `"${options.actualSpace.name}" (${options.actualSpace.dimensions}d)`
    : `space ${options.actual}`
  return `Embedding space mismatch: namespace "${options.namespace}" was indexed with ${expected}, but the configured embedding uses ${actual}; re-index the namespace or configure the retriever with the embedding that built it.`
}
