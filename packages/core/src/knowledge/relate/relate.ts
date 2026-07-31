/**
 * Relation vocabulary factory for connected knowledge.
 *
 * Define typed relation vocabularies and their deterministic claim emission
 * contract for indexing.
 *
 * @module
 */

import type { CruxChunk, CruxDocument } from '../../indexing/types'
import { stableHash } from '../../indexing/hash'
import type { RelationDeriveStage } from '../derive/stage'
import type { KnowledgeModel } from '../model'
import type { KnowledgeRef, KnowledgeRefKind } from '../refs'
import { isKnowledgeRefKind } from '../refs'
const knowledgeRefKindOrder: readonly KnowledgeRefKind[] = ['chunk', 'document', 'entity', 'parent']

/** A single relation type in a relation vocabulary. */
export interface RelationTypeSpec {
  readonly from: readonly KnowledgeRefKind[]
  readonly to: readonly KnowledgeRefKind[]
  readonly direction: 'directed' | 'symmetric'
  readonly description: string
}

/** Placeholder input supplied to deterministic relation runs. */
export interface RelateRunInput {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
}

/** Options attached to an emitted relation claim. */
export interface RelateEmitOptions {
  readonly description?: string
  readonly evidence: KnowledgeRef | readonly KnowledgeRef[]
  readonly provenance?: 'exact' | 'derived'
}

/** A deferred endpoint locator resolved against indexed records during graph compilation. */
export type KnowledgeLocator = { readonly url: string } | { readonly title: string } | { readonly anchor: string }

/** Claim emission API supplied to deterministic relation runs. */
export interface RelateEmitApi<TTypes extends Record<string, RelationTypeSpec>> {
  /** Emit one typed relation claim. */
  emit<TType extends keyof TTypes & string>(
    type: TType,
    from: KnowledgeRefOfKinds<TTypes[TType]['from'][number]> | KnowledgeLocator,
    to: KnowledgeRefOfKinds<TTypes[TType]['to'][number]> | KnowledgeLocator,
    opts?: RelateEmitOptions,
  ): void
}

/** Deterministic relation run function. */
export type RelateRun<TTypes extends Record<string, RelationTypeSpec>> = (
  input: RelateRunInput,
  api: RelateEmitApi<TTypes>,
) => void | Promise<void>

/** Exactly one production mode: model-backed extraction or deterministic code. */
export type StageMode<TRunArgs extends readonly unknown[]> =
  | { readonly model: KnowledgeModel; readonly instructions?: string; readonly run?: never }
  | { readonly model?: never; readonly instructions?: never; readonly run: (...args: TRunArgs) => void | Promise<void> }

/** Configuration for {@link relate}. */
export type RelateConfig<TTypes extends Record<string, RelationTypeSpec>> = {
  readonly id: string
  readonly version: number
  readonly types: TTypes
} & StageMode<[RelateRunInput, RelateEmitApi<TTypes>]>

/** Authored relation vocabulary accepted by the indexing pipeline. */
export type RelationStage<TTypes extends Record<string, RelationTypeSpec>> = RelationDeriveStage & {
  readonly types: TTypes
} & (
    | {
        readonly mode: 'model'
        readonly model: KnowledgeModel
        readonly instructions?: string
        readonly run?: never
      }
    | {
        readonly mode: 'run'
        readonly run: RelateRun<TTypes>
        readonly model?: never
        readonly instructions?: never
      }
  )

/**
 * Create a typed relation vocabulary.
 *
 * @param config - Relation identity, vocabulary, and exactly one production mode.
 * @returns Authored relation configuration for an indexing pipeline.
 *
 * @example
 * ```ts
 * const references = relate({
 *   id: 'references',
 *   version: 1,
 *   types: {
 *     cites: { from: ['chunk'], to: ['document'], direction: 'directed', description: 'A chunk cites a document' },
 *   },
 *   run: (_input, api) => {
 *     const evidence = { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } as const
 *     api.emit('cites', evidence, { kind: 'document', sourceId: 'spec' }, { evidence })
 *   },
 * })
 * ```
 */
export function relate<const TTypes extends Record<string, RelationTypeSpec>>(
  config: RelateConfig<TTypes>,
): RelationStage<TTypes> {
  const mode = validateMode(config)
  const normalizedTypes = normalizeTypes(config.types)
  validateIdentity(config.id, config.version)
  const fingerprintMode = mode === 'model' ? modelFingerprintInput(config) : { kind: 'run' as const }

  const fingerprint = stableHash({
    id: config.id,
    version: config.version,
    types: normalizedTypes,
    mode: fingerprintMode,
  })

  if (mode === 'model') {
    const model = config.model
    if (!model) {
      throw new Error('Relation config requires model mode.')
    }

    return Object.freeze({
      _tag: 'RelationStage' as const,
      kind: 'relation' as const,
      id: config.id,
      version: config.version,
      types: normalizedTypes as TTypes,
      mode,
      model,
      ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
      fingerprint: () => fingerprint,
    })
  }

  const run = config.run
  if (!run) {
    throw new Error('Relation config requires run mode.')
  }

  return Object.freeze({
    _tag: 'RelationStage' as const,
    kind: 'relation' as const,
    id: config.id,
    version: config.version,
    types: normalizedTypes as TTypes,
    mode,
    run,
    fingerprint: () => fingerprint,
  })
}

type KnowledgeRefOfKinds<TKind extends KnowledgeRefKind> = Extract<KnowledgeRef, { readonly kind: TKind }>

type NormalizedRelationTypeSpec = {
  readonly from: readonly KnowledgeRefKind[]
  readonly to: readonly KnowledgeRefKind[]
  readonly direction: 'directed' | 'symmetric'
  readonly description: string
}

function validateIdentity(id: string, version: number): void {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Relation id must be non-empty.')
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Relation version must be an integer greater than or equal to 1.')
  }
}

function validateMode<TTypes extends Record<string, RelationTypeSpec>>(
  config: RelateConfig<TTypes>,
): 'model' | 'run' {
  const record = config as Record<string, unknown>
  const hasModel = record.model !== undefined
  const hasRun = record.run !== undefined

  if (hasModel === hasRun) {
    throw new Error('Relation config requires exactly one of model or run.')
  }
  if (hasRun && typeof record.run !== 'function') {
    throw new Error('Relation run must be a function.')
  }
  if (hasRun && record.instructions !== undefined) {
    throw new Error('Relation instructions require model mode.')
  }
  if (hasModel) {
    validateModel(record.model)
    if (record.instructions !== undefined && typeof record.instructions !== 'string') {
      throw new Error('Relation instructions must be a string.')
    }
    return 'model'
  }
  return 'run'
}

function validateModel(value: unknown): asserts value is KnowledgeModel {
  if (!isRecord(value)) {
    throw new Error('Relation model must be a knowledge model.')
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Relation model name must be non-empty.')
  }
  if (typeof value.fingerprint !== 'string' || !value.fingerprint.trim()) {
    throw new Error('Relation model fingerprint must be non-empty.')
  }
  if (typeof value.generateText !== 'function' || typeof value.generateObject !== 'function') {
    throw new Error('Relation model must provide retrieval methods.')
  }
}

function modelFingerprintInput<TTypes extends Record<string, RelationTypeSpec>>(config: RelateConfig<TTypes>) {
  const model = config.model
  if (!model) {
    throw new Error('Relation config requires model mode.')
  }

  return {
    kind: 'model' as const,
    ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
    model: {
      name: model.name,
      fingerprint: model.fingerprint,
    },
  }
}

function normalizeTypes(types: Record<string, RelationTypeSpec>): Record<string, NormalizedRelationTypeSpec> {
  if (!isRecord(types)) {
    throw new Error('Relation types must be an object.')
  }

  const names = Object.keys(types)
  if (names.length === 0) {
    throw new Error('Relation types must include at least one type.')
  }

  return Object.freeze(
    Object.fromEntries(
      names.sort().map((name) => {
        if (!name.trim()) {
          throw new Error('Relation type names must be non-empty.')
        }
        if (name.includes(':') || name.includes('%')) {
          throw new Error('Relation type names must not contain ":" or "%".')
        }

        const spec = types[name]
        if (!isRecord(spec)) {
          throw new Error(`Relation type "${name}" must be an object.`)
        }
        if (spec.direction !== 'directed' && spec.direction !== 'symmetric') {
          throw new Error(`Relation type "${name}" direction must be directed or symmetric.`)
        }
        if (typeof spec.description !== 'string' || !spec.description.trim()) {
          throw new Error(`Relation type "${name}" description must be non-empty.`)
        }

        return [
          name,
          Object.freeze({
            from: normalizeKinds(name, 'from', spec.from),
            to: normalizeKinds(name, 'to', spec.to),
            direction: spec.direction,
            description: spec.description,
          }),
        ]
      }),
    ),
  )
}

function normalizeKinds(name: string, endpoint: 'from' | 'to', values: unknown): readonly KnowledgeRefKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Relation type "${name}" ${endpoint} kinds must be non-empty.`)
  }

  const unique = new Set<KnowledgeRefKind>()
  for (const value of values) {
    if (!isKnowledgeRefKind(value)) {
      throw new Error(`Relation type "${name}" ${endpoint} kinds must be valid knowledge reference kinds.`)
    }
    unique.add(value)
  }

  return Object.freeze(knowledgeRefKindOrder.filter((kind) => unique.has(kind)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
