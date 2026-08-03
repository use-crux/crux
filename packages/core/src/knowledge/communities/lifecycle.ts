/**
 * Public lifecycle surface for connected knowledge communities.
 *
 * @module
 */

import type { AssetStore, JsonObject, RecordEntry, RecordStore } from '../../storage'
import { knowledgeCurrentKey } from '../keys'
import { asCommunityReportRecord, type CommunityReport } from './records'
import { communityReportPrefix, communityScopeKey } from './keys'
import { buildCommunities, isCommunityBuildInProcess } from './build'
import { createCommunityStore, type CommunityGenerationRetention } from './store'
import type { CommunitiesConfig } from './communities'
import type { ViewRevision } from '../view/revision'

export type CommunityReadinessStatus = 'missing' | 'building' | 'ready' | 'stale'

export interface CommunityBuildDescriptor {
  readonly indexerId: string
  readonly namespace: string
  readonly scopeKey: string
  readonly viewId?: string
}

export interface CommunityRefreshHost {
  /** Ensure a build for the descriptor runs to completion; joining an in-flight equivalent build satisfies the call. */
  ensure(descriptor: CommunityBuildDescriptor, options?: { readonly force?: boolean }): Promise<void>
  /**
   * Return whether retained work is already scheduled or running for this
   * descriptor.
   *
   * Optional. A host that can answer lets `status()` report `"building"` while
   * a refresh is in flight; a host that omits it reports `"stale"` until the
   * refresh publishes.
   */
  hasPending?(descriptor: CommunityBuildDescriptor): boolean
}

export interface CommunityReportsOptions {
  readonly level?: number
  readonly parentId?: string
  readonly cursor?: string
  readonly limit?: number
}

export interface CommunityReportsPage {
  readonly reports: readonly CommunityReport[]
  readonly cursor?: string
}

export interface KnowledgeCommunitiesSurface {
  status(): Promise<CommunityReadinessStatus>
  prepare(options?: { readonly force?: boolean }): Promise<void>
  reports(options?: CommunityReportsOptions): Promise<CommunityReportsPage>
}

export interface CreateCommunitiesSurfaceInput {
  readonly records?: RecordStore
  readonly assets?: AssetStore
  readonly indexerId: string
  readonly namespace: string
  readonly config: CommunitiesConfig
  readonly viewId?: string
  readonly resolveView?: () => Promise<ViewRevision>
  readonly retention?: CommunityGenerationRetention
  readonly refreshHost?: CommunityRefreshHost
}

const warned = new Set<string>()

/** Create a lazy communities lifecycle and report surface. */
export function createKnowledgeCommunitiesSurface(
  input: CreateCommunitiesSurfaceInput,
): KnowledgeCommunitiesSurface {
  async function scope() {
    const view = await input.resolveView?.()
    const scopeKey = communityScopeKey({
      viewId: input.viewId ? `${input.viewId}:${view?.revisionHash ?? 'live'}` : null,
      strategyFingerprint: input.config.strategyFingerprint,
    })
    return { view, scopeKey }
  }

  async function status(): Promise<CommunityReadinessStatus> {
    if (!input.records) throw new Error('knowledgeBase().communities requires record storage.')
    const currentScope = await scope()
    const descriptor = {
      indexerId: input.indexerId,
      namespace: input.namespace,
      scopeKey: currentScope.scopeKey,
      ...(input.viewId ? { viewId: input.viewId } : {}),
    }
    const store = createCommunityStore({ ...input, records: input.records, scopeKey: currentScope.scopeKey })
    if (input.refreshHost?.hasPending?.(descriptor)) return 'building'
    if (isCommunityBuildInProcess(input.indexerId, input.namespace, currentScope.scopeKey)) return 'building'
    if (await store.isLeaseStale(30_000)) return 'stale'
    if ((await store.claimLease('__probe__', { ttlMs: 30_000, now: Date.now() })) === false) return 'building'
    await store.releaseLease('__probe__')

    const pointer = await store.currentGeneration()
    if (!pointer) return 'missing'
    const graphGeneration = await currentGraphGeneration(input.records, input.indexerId, input.namespace)
    const dirty = await store.readDirty()
    const expectedView = currentScope.view?.revisionHash ?? null
    const stale = pointer.viewRevision !== expectedView ||
      pointer.graphGeneration !== graphGeneration ||
      pointer.strategyFingerprint !== input.config.strategyFingerprint ||
      dirty.length > 0
    if (!stale) return 'ready'
    warnStale(input, currentScope.scopeKey, dirty.map((record) => record.sourceId))
    return 'stale'
  }

  async function prepare(options: { readonly force?: boolean } = {}): Promise<void> {
    if (!input.records) throw new Error('knowledgeBase().communities requires record storage.')
    const currentScope = await scope()
    if (!options.force && await status() === 'ready') return
    const descriptor = {
      indexerId: input.indexerId,
      namespace: input.namespace,
      scopeKey: currentScope.scopeKey,
      ...(input.viewId ? { viewId: input.viewId } : {}),
    }
    if (input.refreshHost) return input.refreshHost.ensure(descriptor, options)
    return buildCommunities({
      records: input.records,
      indexerId: input.indexerId,
      namespace: input.namespace,
      config: input.config,
      scopeKey: currentScope.scopeKey,
      ...(input.assets ? { assets: input.assets } : {}),
      ...(currentScope.view ? { view: currentScope.view } : {}),
      retention: input.retention,
      force: options.force,
    })
  }

  async function reports(options: CommunityReportsOptions = {}): Promise<CommunityReportsPage> {
    if (!input.records) throw new Error('knowledgeBase().communities requires record storage.')
    await prepare()
    const currentScope = await scope()
    const store = createCommunityStore({ ...input, records: input.records, scopeKey: currentScope.scopeKey })
    if (options.parentId) {
      const reports = await store.childrenOf(options.parentId)
      return paginateReports(reports, options)
    }
    if (options.level !== undefined) return store.byLevel(options.level, options)
    const pointer = await store.currentGeneration()
    if (!pointer) return { reports: [] }
    const prefix = communityReportPrefix(input.indexerId, input.namespace, currentScope.scopeKey, pointer.generationId)
    const page = await input.records.list(prefix, { cursor: options.cursor, limit: options.limit })
    return {
      reports: page.entries.flatMap((entry) => currentReport(entry, pointer.generationId)),
      ...(page.cursor ? { cursor: page.cursor } : {}),
    }
  }

  return Object.freeze({ status, prepare, reports })
}

async function currentGraphGeneration(records: RecordStore, indexerId: string, namespace: string): Promise<string> {
  const value = await records.get(knowledgeCurrentKey(indexerId, namespace))
  return isRecord(value) && value.namespace === namespace && typeof value.generationId === 'string'
    ? value.generationId
    : 'missing'
}

function currentReport(entry: RecordEntry, generationId: string): readonly CommunityReport[] {
  const report = asCommunityReportRecord(entry.value)
  return report?.generationId === generationId ? [report] : []
}

function paginateReports(reports: readonly CommunityReport[], options: CommunityReportsOptions): CommunityReportsPage {
  const start = options.cursor ? reports.findIndex((report) => report.communityId === options.cursor) + 1 : 0
  const limit = options.limit ?? reports.length
  const page = reports.slice(start, start + limit)
  return {
    reports: page,
    ...(start + limit < reports.length && page.length > 0 ? { cursor: page[page.length - 1]?.communityId } : {}),
  }
}

function warnStale(input: CreateCommunitiesSurfaceInput, scopeKey: string, dirtySourceIds: readonly string[]): void {
  if (
    typeof process !== 'undefined' && (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test')
  ) return
  const key = `${input.indexerId}\0${input.namespace}\0${scopeKey}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[crux] Communities for "${input.indexerId}" in namespace "${input.namespace}" are stale. Call prepare() to refresh.${dirtySourceIds.length ? ` Dirty sources: ${dirtySourceIds.join(', ')}` : ''}`)
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
