/**
 * Assertion vocabulary factory for connected knowledge.
 *
 * Define typed assertion vocabularies and their evidence-backed emission
 * contract for indexing.
 *
 * @module
 */

import { z } from 'zod'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import { stableHash } from '../../indexing/hash'
import type { AssertionDeriveStage, StageMode } from '../derive/stage'
import { assertionWireFingerprintInput } from '../derive/assertion-wire'
import type { KnowledgeModel } from '../model'
import type { KnowledgeRef } from '../refs'
import type { AssertionSupport } from './identity'
import { zodSchemaFingerprintValue } from './identity'
import type { AssertionIdentityRefInput, AssertionRef, AssertionRelationType } from './relations'

/** Select the subset of visible chunks that may be cited as evidence. */
export type AssertionTargetSelector = (chunks: readonly CruxChunk[]) => readonly CruxChunk[]

/** Placeholder input supplied to deterministic assertion runs. */
export interface AssertionRunInput {
  readonly document: CruxDocument
  /** All visible chunks rendered into the derive prompt. */
  readonly chunks: readonly CruxChunk[]
  /** The subset of visible chunks that may be cited as evidence. */
  readonly targets: readonly CruxChunk[]
}

/** Options attached to an emitted assertion claim. */
export interface AssertionEmitOptions {
  readonly evidence: KnowledgeRef | readonly KnowledgeRef[]
  readonly provenance?: 'exact' | 'derived'
}

/** Reference accepted by {@link AssertionEmitApi.relate}. */
export type AssertionRelationEndpoint<TTypes extends Record<string, z.ZodType<unknown>>> =
  | number
  | AssertionRef
  | {
      [T in keyof TTypes & string]: AssertionIdentityRefInput<T, z.infer<TTypes[T]>>
    }[keyof TTypes & string]

/** Options attached to an emitted assertion relation. */
export interface AssertionRelateOptions {
  readonly evidence: KnowledgeRef | readonly KnowledgeRef[]
  readonly provenance?: 'exact' | 'derived'
}

/** Claim emission API supplied to deterministic assertion runs. */
export interface AssertionEmitApi<TTypes extends Record<string, z.ZodType<unknown>>> {
  /** Emit one typed assertion claim. */
  emit<TType extends keyof TTypes & string>(
    type: TType,
    data: z.infer<TTypes[TType]>,
    opts: AssertionEmitOptions,
  ): AssertionRef
  /** Emit one context-independent relation between assertions. */
  relate(
    type: AssertionRelationType,
    from: AssertionRelationEndpoint<TTypes>,
    to: AssertionRelationEndpoint<TTypes>,
    opts: AssertionRelateOptions,
  ): void
}

/** Deterministic assertion run function. */
export type AssertionRun<TTypes extends Record<string, z.ZodType<unknown>>> = (
  input: AssertionRunInput,
  api: AssertionEmitApi<TTypes>,
) => void | Promise<void>

/** Exactly one extracted assertion, discriminated by its authored type name. */
export type AssertionOf<
  TTypes extends Record<string, z.ZodType<unknown>>,
  K extends keyof TTypes = keyof TTypes,
> = {
  [T in K]: {
    readonly assertionId: string
    readonly type: T
    readonly data: z.infer<TTypes[T]>
    readonly evidence: readonly AssertionSupport[]
    readonly provenance: 'exact' | 'derived'
  }
}[K]

/** Configuration for {@link assertions}. */
export type AssertionsConfig<TTypes extends Record<string, z.ZodType<unknown>>> = {
  readonly id: string
  readonly version: number
  readonly types: TTypes
  /** Optional selector narrowing which visible chunks may be cited as evidence. */
  readonly targets?: AssertionTargetSelector
} & StageMode<[AssertionRunInput, AssertionEmitApi<TTypes>]>

/** Authored assertion vocabulary accepted by the indexing pipeline. */
export type AssertionStage<TTypes extends Record<string, z.ZodType<unknown>>> = AssertionDeriveStage & {
  readonly types: TTypes
  readonly targets?: AssertionTargetSelector
} & (
    | {
        readonly mode: 'model'
        readonly model: KnowledgeModel
        readonly instructions?: string
        readonly run?: never
      }
    | {
        readonly mode: 'run'
        readonly run: AssertionRun<TTypes>
        readonly model?: never
        readonly instructions?: never
      }
  )

/**
 * Create a typed assertion vocabulary.
 *
 * @param config - Assertion identity, schema map, and exactly one production mode.
 * @returns Authored assertion configuration for an indexing pipeline.
 *
 * @example
 * ```ts
 * const facts = assertions({
 *   id: 'facts',
 *   version: 1,
 *   types: {
 *     price: z.object({ amount: z.number(), currency: z.string() }).describe('A quoted price'),
 *   },
 *   run: (_input, api) => {
 *     api.emit('price', { amount: 12, currency: 'EUR' }, {
 *       evidence: { kind: 'chunk', sourceId: 'invoice', chunkId: 'c1' },
 *     })
 *   },
 * })
 * ```
 */
export function assertions<const TTypes extends Record<string, z.ZodType<unknown>>>(
  config: AssertionsConfig<TTypes>,
): AssertionStage<TTypes> {
  const mode = validateMode(config)
  const normalizedTypes = normalizeTypes(config.types)
  validateIdentity(config.id, config.version)
  const targets = validateTargets(config.targets)
  const fingerprintMode = mode === 'model' ? modelFingerprintInput(config) : { kind: 'run' as const }
  const fingerprint = stableHash({
    id: config.id,
    version: config.version,
    types: schemaFingerprintInput(normalizedTypes),
    ...(mode === 'model' ? { wire: assertionWireFingerprintInput(normalizedTypes) } : {}),
    mode: fingerprintMode,
  })

  if (mode === 'model') {
    const model = config.model
    if (!model) throw new Error('Assertion config requires model mode.')
    return Object.freeze({
      _tag: 'AssertionStage' as const,
      kind: 'assertion' as const,
      id: config.id,
      version: config.version,
      types: normalizedTypes as TTypes,
      mode,
      model,
      ...(targets !== undefined ? { targets } : {}),
      ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
      fingerprint: () => fingerprint,
    })
  }

  const run = config.run
  if (!run) throw new Error('Assertion config requires run mode.')
  return Object.freeze({
    _tag: 'AssertionStage' as const,
    kind: 'assertion' as const,
    id: config.id,
    version: config.version,
    types: normalizedTypes as TTypes,
    mode,
    run,
    ...(targets !== undefined ? { targets } : {}),
    fingerprint: () => fingerprint,
  })
}

function validateTargets(value: unknown): AssertionTargetSelector | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'function') throw new Error('Assertion targets must be a function.')
  return value as AssertionTargetSelector
}

function validateIdentity(id: string, version: number): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Assertion id must be non-empty.')
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Assertion version must be an integer greater than or equal to 1.')
  }
}

function validateMode<TTypes extends Record<string, z.ZodType<unknown>>>(
  config: AssertionsConfig<TTypes>,
): 'model' | 'run' {
  const record = config as Record<string, unknown>
  const hasModel = record.model !== undefined
  const hasRun = record.run !== undefined
  if (hasModel === hasRun) throw new Error('Assertion config requires exactly one of model or run.')
  if (hasRun && typeof record.run !== 'function') throw new Error('Assertion run must be a function.')
  if (hasRun && record.instructions !== undefined) throw new Error('Assertion instructions require model mode.')
  if (hasModel) {
    validateModel(record.model)
    if (record.instructions !== undefined && typeof record.instructions !== 'string') {
      throw new Error('Assertion instructions must be a string.')
    }
    return 'model'
  }
  return 'run'
}

function validateModel(value: unknown): asserts value is KnowledgeModel {
  if (!isRecord(value)) throw new Error('Assertion model must be a knowledge model.')
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Assertion model name must be non-empty.')
  }
  if (typeof value.fingerprint !== 'string' || !value.fingerprint.trim()) {
    throw new Error('Assertion model fingerprint must be non-empty.')
  }
  if (typeof value.generateText !== 'function' || typeof value.generateObject !== 'function') {
    throw new Error('Assertion model must provide retrieval methods.')
  }
}

function modelFingerprintInput<TTypes extends Record<string, z.ZodType<unknown>>>(config: AssertionsConfig<TTypes>) {
  const model = config.model
  if (!model) throw new Error('Assertion config requires model mode.')
  return {
    kind: 'model' as const,
    ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
    model: { name: model.name, fingerprint: model.fingerprint },
  }
}

function normalizeTypes<TTypes extends Record<string, z.ZodType<unknown>>>(types: TTypes): TTypes {
  if (!isRecord(types)) throw new Error('Assertion types must be an object.')
  const names = Object.keys(types)
  if (names.length === 0) throw new Error('Assertion types must include at least one type.')
  return Object.freeze(Object.fromEntries(names.sort().map((name) => {
    if (!name.trim()) throw new Error('Assertion type names must be non-empty.')
    if (name.includes(':') || name.includes('%')) {
      throw new Error('Assertion type names must not contain ":" or "%".')
    }
    const schema = types[name]
    if (!isZodType(schema)) throw new Error(`Assertion type "${name}" must be a Zod schema.`)
    return [name, schema]
  }))) as TTypes
}

function schemaFingerprintInput(types: Record<string, z.ZodType<unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(types).map(([name, schema]) => [name, schemaFingerprintValue(schema)]))
}

function schemaFingerprintValue(schema: z.ZodType<unknown>): unknown {
  try {
    return zodSchemaFingerprintValue(schema)
  } catch {
    const explicitFingerprint = schema.meta()?.cruxFingerprint
    if (typeof explicitFingerprint !== 'string' || !explicitFingerprint.trim()) {
      throw new Error('Unrepresentable assertion schemas require meta({ cruxFingerprint: "..." }).')
    }
    return {
      unrepresentable: (schema as { _zod?: { def?: { type?: unknown } } })._zod?.def?.type ?? 'schema',
      description: schema.description ?? null,
      explicitFingerprint,
    }
  }
}

function isZodType(value: unknown): value is z.ZodType<unknown> {
  return isRecord(value) && typeof value.safeParse === 'function'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
