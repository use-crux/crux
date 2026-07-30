/**
 * Inert derive-stage contracts for connected knowledge pipeline configuration.
 *
 * Derive stages are authored config data that can participate in
 * {@link import('../../indexing').IndexingPipeline} identity.
 *
 * @module
 */

/** Shared identity for a post-chunk derivation stage. */
export interface BaseDeriveStage {
  /** Stable stage id within an indexing pipeline. */
  readonly id: string
  /** Authored stage contract version. */
  readonly version: number
  /** Stable stage fingerprint including all output-affecting configuration. */
  fingerprint(): string
}

/** Relation-producing derive-stage config. */
export interface RelationDeriveStage extends BaseDeriveStage {
  /** Stable runtime tag for relation derive stages. */
  readonly _tag: 'RelationStage'
  /** Derive-stage kind. */
  readonly kind: 'relation'
}

/** Assertion-producing derive-stage config. */
export interface AssertionDeriveStage extends BaseDeriveStage {
  /** Stable runtime tag for assertion derive stages. */
  readonly _tag: 'AssertionStage'
  /** Derive-stage kind. */
  readonly kind: 'assertion'
}

/** Inert post-chunk derive-stage config accepted by {@link import('../../indexing').indexingPipeline}. */
export type DeriveStage = RelationDeriveStage | AssertionDeriveStage
