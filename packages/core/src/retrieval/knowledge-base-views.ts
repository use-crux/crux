/**
 * Connected knowledge view facade wiring for knowledge bases.
 *
 * @module
 */

import { z } from 'zod'
import { grounding } from '../citations'
import type { Grounding } from '../citations'
import type { EmbeddingModality } from '../embedding'
import { indexedChunkKey } from '../indexed-knowledge/keys'
import { indexedChunkToHit } from '../indexed-knowledge/records'
import { loadViewRevision, type ViewRevision } from '../knowledge/view/revision'
import type { KnowledgeViewRegistry, ViewRegistration } from '../knowledge/view/registry'
import type {
  KnowledgeBaseViewConfig,
  KnowledgeView,
  KnowledgeViewRecipeConfig,
  KnowledgeViewResolution,
  KnowledgeViewRetrieverConfig,
} from '../knowledge/view/view'
import { normalizeViewWhere, type NormalizedViewWhere } from '../knowledge/view/where'
import type { ExactFilter, RecordStore } from '../storage'
import { createRetrieverEntity } from './entity'
import type { KnowledgeBaseFilter, KnowledgeBaseGroundingConfig } from './knowledge-base'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'
import { retrievalRecipe, type RetrievalRecipe } from './recipe/recipe'
import { retrieve } from './recipe/steps/built-ins'
import type { RetrievalStep } from './recipe/step'
import type { Retriever, RetrieverHit, RetrievalToolConfig, RetrieverTools } from './types'

const branchCeiling = 16

interface KnowledgeBaseViewFactoryConfig<
  TMetadataSchema extends z.ZodType<unknown> | undefined,
  TModality extends EmbeddingModality,
> {
  readonly id: string
  readonly namespace: string
  readonly metadataSchema?: TMetadataSchema
  readonly view: KnowledgeBaseViewConfig<TMetadataSchema>
  readonly records?: RecordStore
  readonly registry: KnowledgeViewRegistry
  readonly retriever: <TFilter extends ExactFilter>(config?: KnowledgeViewRetrieverConfig<TFilter>) => Retriever<TFilter, TModality>
  readonly knowledgeBinding: () => RetrievalKnowledgeBinding | undefined
  readonly pinnedRevisionHash?: string
}

/** Create a public connected-knowledge view handle. Internal. */
export function createKnowledgeBaseView<
  const TMetadataSchema extends z.ZodType<unknown> | undefined,
  const TModality extends EmbeddingModality,
>(config: KnowledgeBaseViewFactoryConfig<TMetadataSchema, TModality>): KnowledgeView<TMetadataSchema, TModality> {
  const schema = requireObjectMetadataSchema(config.id, config.metadataSchema)
  const where = normalizeViewWhere(config.view.where, schema)
  const registration = { viewId: config.view.id, where }
  config.registry.register(registration)
  return createViewHandle(config, registration)
}

function createViewHandle<
  const TMetadataSchema extends z.ZodType<unknown> | undefined,
  const TModality extends EmbeddingModality,
>(
  config: KnowledgeBaseViewFactoryConfig<TMetadataSchema, TModality>,
  registration: ViewRegistration,
): KnowledgeView<TMetadataSchema, TModality> {
  let resolved: ViewRevision | undefined

  async function revision(): Promise<ViewRevision> {
    if (config.pinnedRevisionHash) {
      if (resolved) return resolved
      if (!config.records) throw new Error(`knowledgeBase().view("${registration.viewId}") requires record storage.`)
      const stored = await loadViewRevision({
        records: config.records,
        indexerId: config.id,
        namespace: config.namespace,
        viewId: registration.viewId,
        revisionHash: config.pinnedRevisionHash,
      })
      if (!stored) {
        throw new Error(`View "${registration.viewId}" revision "${config.pinnedRevisionHash}" does not exist in namespace "${config.namespace}".`)
      }
      await config.registry.assertRevisionAvailable(registration.viewId, stored)
      resolved = stored
      return stored
    }
    resolved = await config.registry.resolveCurrent(registration)
    return resolved
  }

  async function resolve(): Promise<KnowledgeViewResolution> {
    const current = await revision()
    return {
      revisionHash: current.revisionHash,
      members: current.members.map((member) => member.sourceId),
    }
  }

  function memberBinding(): RetrievalKnowledgeBinding | undefined {
    const binding = config.knowledgeBinding()
    if (!binding) return undefined
    return {
      ...binding,
      hydrate: async (ref) => {
        const hit = await binding.hydrate(ref)
        if (!hit) return null
        return (await memberSet()).has(hit.source.id) ? hit : null
      },
    }
  }

  async function availableRevision(): Promise<ViewRevision> {
    const current = await revision()
    await config.registry.assertRevisionAvailable(registration.viewId, current)
    return current
  }

  async function memberSet(): Promise<ReadonlySet<string>> {
    return new Set((await availableRevision()).members.map((member) => member.sourceId))
  }

  const handle: KnowledgeView<TMetadataSchema, TModality> = {
    id: registration.viewId,
    namespace: config.namespace,
    resolve,
    at: (revisionHash) =>
      createViewHandle({ ...config, pinnedRevisionHash: revisionHash }, registration),
    retriever: (retrieverConfig) =>
      createViewRetriever({
        id: `${config.id}:${registration.viewId}`,
        indexerId: config.id,
        namespace: config.namespace,
        where: registration.where,
        base: config.retriever(retrieverConfig as KnowledgeViewRetrieverConfig<ExactFilter> | undefined),
        records: config.records,
        resolveRevision: availableRevision,
        assertRevisionAvailable: (current) => config.registry.assertRevisionAvailable(registration.viewId, current),
        defaultLimit: retrieverConfig?.limit,
        defaultFilter: retrieverConfig?.filter as ExactFilter | undefined,
      }) as Retriever<KnowledgeBaseFilter<TMetadataSchema>, TModality>,
    recipe: <const TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]>(
      recipeConfig?: KnowledgeViewRecipeConfig<TSteps>,
    ): RetrievalRecipe => {
      const viewRetriever = handle.retriever() as unknown as Retriever
      const knowledge = memberBinding()
      if (!recipeConfig) {
        return retrievalRecipe({
          id: `${config.id}:${registration.viewId}-recipe`,
          retriever: viewRetriever,
          steps: [retrieve()] as const,
          ...(knowledge ? { knowledge } : {}),
        })
      }
      return retrievalRecipe({
        ...recipeConfig,
        retriever: viewRetriever,
        ...(knowledge ? { knowledge } : {}),
      })
    },
    grounding: (groundingConfig?: KnowledgeBaseGroundingConfig): Grounding =>
      grounding({
        ...(groundingConfig ?? {}),
        id: groundingConfig?.id ?? `grounding:${config.id}:${registration.viewId}`,
        retriever: handle.retriever() as unknown as Retriever,
      }),
    tools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => handle.retriever().asTools(toolConfig),
    inspect: () => ({
      id: registration.viewId,
      namespace: config.namespace,
      where: registration.where,
      ...(resolved ? { revisionHash: resolved.revisionHash } : {}),
    }),
  }
  return Object.freeze(handle)
}

function createViewRetriever<TModality extends EmbeddingModality>(config: {
  readonly id: string
  readonly indexerId: string
  readonly namespace: string
  readonly where: NormalizedViewWhere
  readonly base: Retriever<ExactFilter, TModality>
  readonly records?: RecordStore
  readonly resolveRevision: () => Promise<ViewRevision>
  readonly assertRevisionAvailable: (revision: ViewRevision) => Promise<void>
  readonly defaultLimit?: number
  readonly defaultFilter?: ExactFilter
}): Retriever<ExactFilter, TModality> {
  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: config.base.mode,
    retrieve: async (request) => {
      const branches = expandBranches(config.where, { ...(config.defaultFilter ?? {}), ...(request.filter ?? {}) })
      if (branches.length > branchCeiling) {
        throw new Error(
          `View "${config.id}" expands to ${branches.length} vector filter branches; the portable path supports at most ${branchCeiling}. Narrow the predicate, split the view, or use storage with connected-knowledge view pushdown.`,
        )
      }
      const limit = request.limit ?? config.defaultLimit
      const revision = await config.resolveRevision()
      const members = new Set(revision.members.map((member) => member.sourceId))
      const groups = await Promise.all(branches.map((filter) => config.base.retrieve({ ...request, limit, filter })))
      await config.assertRevisionAvailable(revision)
      return bestHits(groups.flat().filter((hit) => members.has(hit.source.id)), limit)
    },
    ...(config.records ? { getSource: viewGetSource(config) } : {}),
  })
}

function expandBranches(where: NormalizedViewWhere, base: ExactFilter): ExactFilter[] {
  const branches = where.any.flatMap((clause) =>
    clause.reduce<ExactFilter[]>(
      (partials, term) => partials.flatMap((partial) =>
        term.values.flatMap((value) => mergeBranchTerm(partial, term.field, value))),
      [base],
    ),
  )
  return dedupeFilters(branches)
}

function mergeBranchTerm(partial: ExactFilter, field: string, value: ExactFilter[string]): readonly ExactFilter[] {
  if (partial[field] !== undefined && partial[field] !== value) return []
  return [{ ...partial, [field]: value }]
}

function viewGetSource(config: {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly resolveRevision: () => Promise<ViewRevision>
  readonly assertRevisionAvailable: (revision: ViewRevision) => Promise<void>
}) {
  return async (lookup: { readonly namespace: string; readonly sourceId: string; readonly chunkId: string }): Promise<RetrieverHit | null> => {
    if (!config.records || lookup.namespace !== config.namespace) return null
    const revision = await config.resolveRevision()
    if (!revision.members.some((member) => member.sourceId === lookup.sourceId)) return null
    await config.assertRevisionAvailable(revision)
    const value = await config.records.get(indexedChunkKey(config.indexerId, config.namespace, lookup.sourceId, lookup.chunkId))
    return value ? indexedChunkToHit({ value, score: 1 }) : null
  }
}

function dedupeFilters(filters: readonly ExactFilter[]): ExactFilter[] {
  const seen = new Set<string>()
  const result: ExactFilter[] = []
  for (const filter of filters) {
    const normalized = Object.keys(filter).sort().map((key) => [key, filter[key]])
    const key = JSON.stringify(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(filter)
  }
  return result
}

function bestHits(hits: readonly RetrieverHit[], limit: number | undefined): RetrieverHit[] {
  const byKey = new Map<string, RetrieverHit>()
  for (const hit of hits) {
    const key = hitKey(hit)
    const existing = byKey.get(key)
    if (!existing || hit.score > existing.score) byKey.set(key, hit)
  }
  const ranked = [...byKey.values()].sort((left, right) => right.score - left.score || hitKey(left).localeCompare(hitKey(right)))
  return limit === undefined ? ranked : ranked.slice(0, limit)
}

function hitKey(hit: RetrieverHit): string {
  return `${hit.namespace}:${hit.source.id}:${hit.chunkId}`
}

function requireObjectMetadataSchema(
  id: string,
  schema: z.ZodType<unknown> | undefined,
): z.ZodObject<z.ZodRawShape> {
  if (schema instanceof z.ZodObject) return schema
  throw new Error(`knowledgeBase("${id}").view() requires an object metadataSchema.`)
}
