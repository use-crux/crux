/**
 * Built-in generic entity relation stage.
 *
 * Extract entity mentions and bounded entity-to-entity relationships from
 * chunk text through an explicit model binding.
 *
 * @module
 */

import { z } from 'zod'
import { createStableId, stableHash } from '../../indexing/hash'
import type { CruxChunk } from '../../indexing/types'
import { generateObjectWithEvidence } from '../derive/modality-validation'
import type { KnowledgeModel } from '../model'
import type { KnowledgeRef } from '../refs'
import { relate, type RelationStage } from './relate'

const maxDescriptionLength = 500

const entityTypes = {
  mentions: {
    from: ['chunk'],
    to: ['entity'],
    direction: 'directed',
    description: 'A chunk mentions an entity',
  },
  related: {
    from: ['entity'],
    to: ['entity'],
    direction: 'symmetric',
    description: 'Two entities are related in the source text',
  },
} as const

const entityExtractionSchema = z.object({
  mentions: z.array(z.object({
    chunkId: z.string().min(1),
    name: z.string().min(1),
  }).strict()),
  related: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    description: z.string().max(maxDescriptionLength).optional(),
    chunkIds: z.array(z.string().min(1)).optional(),
  }).strict()),
}).strict()

/** Configuration for {@link relateEntities}. */
export interface RelateEntitiesConfig {
  /** Model used to extract generic entity relations. */
  readonly model: KnowledgeModel
  /** Stable stage id within an indexing pipeline. */
  readonly id?: string
  /** Additional extraction guidance appended to the built-in prompt. */
  readonly instructions?: string
}

/**
 * Create the built-in generic entity relation stage.
 *
 * @param config - Model binding plus optional identity and instructions.
 * @returns A relation stage that emits `mentions` and `related` claims.
 *
 * @example
 * ```ts
 * const pipeline = indexingPipeline({
 *   derive: [relateEntities({ model })],
 * })
 * ```
 */
export function relateEntities(config: RelateEntitiesConfig): RelationStage<typeof entityTypes> {
  validateModel(config?.model)
  const model = config.model
  const base = relate({
    id: config.id ?? 'entities',
    version: 1,
    types: entityTypes,
    run: async (input, api) => {
      const chunksById = new Map(input.chunks.map((chunk) => [chunk.chunkId, chunk]))
      const result = await generateObjectWithEvidence({
        model,
        system: 'Return only entity mentions and entity relationships that match the requested schema.',
        prompt: renderPrompt(input.chunks, config.instructions),
        schema: entityExtractionSchema,
        sourceId: input.document.sourceId,
        chunks: input.chunks,
        subject: `stage "${config.id ?? 'entities'}"`,
        ...(input.assets ? { assets: input.assets } : {}),
      })
      const parsed = entityExtractionSchema.safeParse(result.object)
      if (!parsed.success) {
        throw new Error(`Relation ${config.id ?? 'entities'} returned invalid entity relations.`)
      }

      const mentions = new Map<string, Mention>()
      for (const item of parsed.data.mentions) {
        const chunk = chunksById.get(item.chunkId)
        if (!chunk) continue
        const entity = entityRef(item.name)
        const evidence = chunkRef(chunk)
        mentions.set(`${evidence.sourceId}:${evidence.chunkId}:${entity.entityId}`, { evidence, entity })
      }

      for (const item of [...mentions.values()].sort(compareMentions)) {
        api.emit('mentions', item.evidence, item.entity, {
          evidence: item.evidence,
          provenance: 'derived',
        })
      }

      const related = new Map<string, Related>()
      for (const item of parsed.data.related) {
        const from = entityRef(item.from)
        const to = entityRef(item.to)
        if (from.entityId === to.entityId) continue
        const evidence = evidenceFor(input.chunks, item.chunkIds)
        if (evidence.length === 0) continue
        const key = [from.entityId, to.entityId].sort().join('\0')
        related.set(key, {
          from,
          to,
          evidence,
          ...(item.description ? { description: item.description } : {}),
        })
      }

      for (const item of [...related.values()].sort(compareRelated)) {
        api.emit('related', item.from, item.to, {
          evidence: item.evidence,
          provenance: 'derived',
          ...(item.description ? { description: item.description } : {}),
        })
      }
    },
  })
  const fingerprint = stableHash({
    id: base.id,
    version: base.version,
    types: base.types,
    mode: {
      kind: 'model',
      model: { name: model.name, fingerprint: model.fingerprint },
      ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
    },
  })

  return Object.freeze({
    ...base,
    fingerprint: () => fingerprint,
  })
}

type ChunkRef = Extract<KnowledgeRef, { readonly kind: 'chunk' }>
type EntityRef = Extract<KnowledgeRef, { readonly kind: 'entity' }>

interface Mention {
  readonly evidence: ChunkRef
  readonly entity: EntityRef
}

interface Related {
  readonly from: EntityRef
  readonly to: EntityRef
  readonly evidence: readonly ChunkRef[]
  readonly description?: string
}

function validateModel(value: unknown): asserts value is KnowledgeModel {
  if (!isRecord(value)) {
    throw new Error('Entity relations require a knowledge model.')
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Entity relation model name must be non-empty.')
  }
  if (typeof value.fingerprint !== 'string' || !value.fingerprint.trim()) {
    throw new Error('Entity relation model fingerprint must be non-empty.')
  }
  if (typeof value.generateText !== 'function' || typeof value.generateObject !== 'function') {
    throw new Error('Entity relation model must provide retrieval methods.')
  }
}

function entityRef(name: string): EntityRef {
  return { kind: 'entity', entityId: createStableId('entity', normalizeName(name)) }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function chunkRef(chunk: CruxChunk): ChunkRef {
  return { kind: 'chunk', sourceId: chunk.sourceId, chunkId: chunk.chunkId }
}

function evidenceFor(chunks: readonly CruxChunk[], chunkIds: readonly string[] | undefined): readonly ChunkRef[] {
  const selected = chunkIds?.length
    ? chunks.filter((chunk) => chunkIds.includes(chunk.chunkId))
    : chunks
  const refs = selected.map(chunkRef)
  return [...new Map(refs.map((ref) => [`${ref.sourceId}:${ref.chunkId}`, ref])).values()]
    .sort(compareChunkRefs)
}

function renderPrompt(chunks: readonly CruxChunk[], instructions: string | undefined): string {
  return [
    instructions,
    'Extract canonical entity names mentioned in each chunk and concise relationships between entities.',
    'Use chunk ids exactly as shown.',
    chunks.map((chunk) => `[${chunk.chunkId}] ${bound(chunk.content)}`).join('\n'),
  ].filter(Boolean).join('\n\n')
}

function bound(value: string): string {
  return value.length <= 1200 ? value : value.slice(0, 1200)
}

function compareMentions(left: Mention, right: Mention): number {
  return `${left.evidence.sourceId}:${left.evidence.chunkId}:${left.entity.entityId}`
    .localeCompare(`${right.evidence.sourceId}:${right.evidence.chunkId}:${right.entity.entityId}`)
}

function compareRelated(left: Related, right: Related): number {
  return relationKey(left).localeCompare(relationKey(right))
}

function relationKey(value: Related): string {
  return [value.from.entityId, value.to.entityId].sort().join(':')
}

function compareChunkRefs(left: ChunkRef, right: ChunkRef): number {
  return `${left.sourceId}:${left.chunkId}`.localeCompare(`${right.sourceId}:${right.chunkId}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
