/**
 * Connected-knowledge integration for the knowledge base runtime.
 *
 * Owns the graph binding cache, view membership maintenance, and the
 * derive → compile → cleanup passes that run around indexing and removal, so
 * the runtime module stays focused on indexing and retrieval wiring.
 *
 * @module
 */

import { indexedNamespacePrefix, indexedSourcePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import { compileKnowledgeGeneration, deleteKnowledgeClaimsForSource } from '../knowledge/compile'
import { runDeriveStages, type DeriveStageRunResult } from '../knowledge/derive/runner'
import type { DeriveStage } from '../knowledge/derive/stage'
import { createKnowledgeGraphStore } from '../knowledge/graph-store'
import { communityScopeKey } from '../knowledge/communities/keys'
import { createCommunityStore } from '../knowledge/communities/store'
import type { CommunitiesConfig } from '../knowledge/communities/communities'
import { createKnowledgeViewRegistry, type KnowledgeViewRegistry } from '../knowledge/view/registry'
import type { KnowledgeGenerationRetention } from '../knowledge/generation'
import { relateEntities } from '../knowledge/relate/entities'
import type { CruxChunk, CruxDocument, IndexingPipeline } from '../indexing'
import type { ConnectedKnowledgeStageSummary, ConnectedKnowledgeSummary } from '../indexing'
import type { AssetStore, JsonObject, RecordStore } from '../storage'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'

const MAX_KNOWLEDGE_SUMMARY_WARNINGS = 50

/** Configuration for {@link createConnectedKnowledgeIntegration}. Internal. */
export interface ConnectedKnowledgeIntegrationConfig {
  readonly records?: RecordStore
  readonly assets?: AssetStore
  readonly indexerId: string
  readonly namespace: string
  readonly pipeline?: IndexingPipeline
  readonly communities?: CommunitiesConfig
  readonly retention: KnowledgeGenerationRetention
}

/** Runtime hooks for connected-knowledge derivation and graph access. Internal. */
export interface ConnectedKnowledgeIntegration {
  /** Return recipe-step graph access when records are configured. */
  binding(): RetrievalKnowledgeBinding | undefined
  /** Return the per-runtime view registry. */
  viewRegistry(): KnowledgeViewRegistry
  /** Update view membership, then run derive stages and compile when configured. */
  afterIndex(sourceIds?: readonly string[]): Promise<ConnectedKnowledgeSummary | undefined>
  /** Drop removed-source view membership and claims, then recompile when configured. */
  afterRemove(sourceId: string): Promise<void>
}

/** Create the connected-knowledge hooks used by the knowledge base runtime. Internal. */
export function createConnectedKnowledgeIntegration(
  config: ConnectedKnowledgeIntegrationConfig,
): ConnectedKnowledgeIntegration {
  const { records, indexerId, namespace } = config
  let graphStore: ReturnType<typeof createKnowledgeGraphStore> | undefined
  const views = createKnowledgeViewRegistry({ records, indexerId, namespace })
  const deriveStages = effectiveDeriveStages(config.pipeline, config.communities)

  function binding(): RetrievalKnowledgeBinding | undefined {
    if (!records) return undefined
    graphStore ??= createKnowledgeGraphStore({ records, indexerId, namespace })
    return {
      reader: graphStore,
      namespace,
      hydrate: graphStore.hydrate,
    }
  }

  async function compile(): Promise<void> {
    if (!records || !hasConnectedFeature(deriveStages, config.communities)) return
    await compileKnowledgeGeneration({ records, indexerId, namespace, retention: config.retention })
    graphStore = undefined
  }

  async function afterIndex(sourceIds?: readonly string[]): Promise<ConnectedKnowledgeSummary | undefined> {
    await views.afterIndex(sourceIds)
    if (!records || !hasConnectedFeature(deriveStages, config.communities)) return undefined
    await markCommunitiesDirty(sourceIds ?? await activeSourceIds(records, indexerId, namespace), 'indexed')
    const stageRuns: DeriveStageRunResult[] = []
    for (const sourceId of await activeSourceIds(records, indexerId, namespace)) {
      const source = await activeSource(records, indexerId, namespace, sourceId)
      if (!source) continue
      stageRuns.push(...await runDeriveStages({
        records,
        indexerId,
        namespace,
        stages: deriveStages,
        document: source.document,
        chunks: source.chunks,
        ...(config.assets ? { assets: config.assets } : {}),
      }))
    }
    await compile()
    return summarizeDeriveRuns(stageRuns)
  }

  async function afterRemove(sourceId: string): Promise<void> {
    await views.afterRemove(sourceId)
    if (records && hasConnectedFeature(deriveStages, config.communities)) {
      await markCommunitiesDirty([sourceId], 'removed')
      await deleteKnowledgeClaimsForSource({
        records,
        indexerId,
        namespace,
        sourceId,
        stageIds: deriveStages.map((stage) => stage.id),
      })
      await compile()
    }
  }

  function viewRegistry(): KnowledgeViewRegistry {
    return views
  }

  async function markCommunitiesDirty(sourceIds: readonly string[], reason: 'indexed' | 'removed'): Promise<void> {
    if (!records || !config.communities) return
    const scopeKey = communityScopeKey({
      strategyFingerprint: config.communities.strategyFingerprint,
    })
    const store = createCommunityStore({ records, indexerId, namespace, scopeKey, retention: config.retention })
    await Promise.all(Array.from(new Set(sourceIds)).sort().map((sourceId) => store.markDirty(sourceId, reason)))
  }

  return Object.freeze({ binding, viewRegistry, afterIndex, afterRemove })
}

function hasConnectedFeature(stages: readonly DeriveStage[], communities: CommunitiesConfig | undefined): boolean {
  return stages.length > 0 || communities !== undefined
}

function summarizeDeriveRuns(runs: readonly DeriveStageRunResult[]): ConnectedKnowledgeSummary {
  const byStage = new Map<string, {
    readonly stageId: string
    ran: number
    cached: number
    claims: number
    warnings: string[]
    extraWarnings: number
  }>()
  for (const run of runs) {
    let stage = byStage.get(run.stageId)
    if (!stage) {
      stage = { stageId: run.stageId, ran: 0, cached: 0, claims: 0, warnings: [], extraWarnings: 0 }
      byStage.set(run.stageId, stage)
    }
    stage[run.status] += 1
    stage.claims += run.claims
    appendBoundedWarnings(stage, run.warnings)
  }
  const stages: ConnectedKnowledgeStageSummary[] = [...byStage.values()].map((stage) => ({
    stageId: stage.stageId,
    status: { ran: stage.ran, cached: stage.cached },
    claims: stage.claims,
    warnings: stage.extraWarnings > 0 ? [...stage.warnings, `+${stage.extraWarnings} more`] : [...stage.warnings],
  }))
  return { stages }
}

function appendBoundedWarnings(
  stage: { warnings: string[]; extraWarnings: number },
  warnings: readonly string[],
): void {
  for (const warning of warnings) {
    if (stage.warnings.length < MAX_KNOWLEDGE_SUMMARY_WARNINGS) {
      stage.warnings.push(warning)
    } else {
      stage.extraWarnings += 1
    }
  }
}

function effectiveDeriveStages(
  pipeline: IndexingPipeline | undefined,
  communities: CommunitiesConfig | undefined,
): readonly DeriveStage[] {
  const authored = [...(pipeline?.derive ?? [])]
  if (!communities || hasAuthoredEntityMapping(authored)) return authored
  return [...authored, relateEntities({ id: '__communities_entities', model: communities.model })]
}

function hasAuthoredEntityMapping(stages: readonly DeriveStage[]): boolean {
  return stages.some((stage) => {
    const value = stage as DeriveStage & { readonly types?: unknown }
    if (stage._tag !== 'RelationStage' || !isRecord(value.types)) return false
    const mentions = value.types.mentions
    const related = value.types.related
    return isRecord(mentions) &&
      Array.isArray(mentions.from) &&
      Array.isArray(mentions.to) &&
      mentions.from.includes('chunk') &&
      mentions.to.includes('entity') &&
      isRecord(related) &&
      Array.isArray(related.from) &&
      Array.isArray(related.to) &&
      related.from.includes('entity') &&
      related.to.includes('entity')
  })
}

async function activeSourceIds(records: RecordStore, indexerId: string, namespace: string): Promise<readonly string[]> {
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  const sourceIds = entries.flatMap((entry) => {
    const value = entry.value
    return value.active === true && typeof value.sourceId === 'string' ? [value.sourceId] : []
  })
  return Array.from(new Set(sourceIds)).sort()
}

async function activeSource(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  sourceId: string,
): Promise<{ readonly document: CruxDocument; readonly chunks: readonly CruxChunk[] } | null> {
  const entries = await listIndexedEntries(records, indexedSourcePrefix(indexerId, namespace, sourceId))
  const chunks = entries
    .flatMap((entry) => indexedChunk(entry.value, namespace))
    .sort((left, right) => left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId))
  if (chunks.length === 0) return null
  const first = chunks[0]
  return {
    document: {
      namespace,
      sourceId,
      ...(first?.source ? { source: first.source } : {}),
      content: chunks.map((chunk) => chunk.content).join('\n\n'),
      ...(documentTitle(chunks) ? { title: documentTitle(chunks) } : {}),
      metadata: first?.metadata ?? {},
    },
    chunks,
  }
}

function indexedChunk(value: JsonObject, namespace: string): readonly CruxChunk[] {
  if (
    value._cruxRecordType !== 'chunk' ||
    value.active !== true ||
    value.namespace !== namespace ||
    typeof value.sourceId !== 'string' ||
    typeof value.chunkId !== 'string' ||
    typeof value.ordinal !== 'number' ||
    typeof value.content !== 'string'
  ) {
    return []
  }
  return [{
    namespace,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    ordinal: value.ordinal,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    ...(isRecord(value.source) ? { source: value.source as CruxChunk['source'] } : {}),
    ...(isRecord(value.parent) ? { parent: value.parent as CruxChunk['parent'] } : {}),
    ...(isRecord(value.provenance) ? { provenance: value.provenance as CruxChunk['provenance'] } : {}),
  }]
}

function documentTitle(chunks: readonly CruxChunk[]): string | undefined {
  for (const chunk of chunks) {
    if (chunk.parent?.title) return chunk.parent.title
    if (typeof chunk.metadata.title === 'string') return chunk.metadata.title
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
