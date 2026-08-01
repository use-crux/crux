import { indexedNamespacePrefix } from '../../../indexed-knowledge/keys'
import { indexedChunkToHit } from '../../../indexed-knowledge/records'
import { asCommunityGenerationPointerRecord, type CommunityGenerationPointerRecord, type CommunityReport } from '../../../knowledge/communities/records'
import { communityReportPrefix } from '../../../knowledge/communities/keys'
import { knowledgeCurrentKey } from '../../../knowledge/keys'
import type { ViewRevision } from '../../../knowledge/view/revision'
import type { JsonObject, RecordEntry, RecordStore } from '../../../storage'
import type { RetrievalCommunitiesBinding } from '../knowledge-binding'
import { GLOBAL_SEARCH_BATCH_BUDGET, type FreshnessResolution, type SearchUnit } from './global-search-types'

export async function resolveGlobalSearchFreshness(
  binding: RetrievalCommunitiesBinding,
): Promise<FreshnessResolution> {
  const view = await binding.resolveView?.()
  const ready = await binding.surface.status()
  if (ready === 'ready') {
    const reports = await readSurfaceReports(binding.surface)
    return resolution(binding, view, reports, 'exact', 'current community generation matched the pinned read surface')
  }

  const compensated = await tryCompensatedAdditions(binding, view)
  if (compensated) return compensated

  const raw = await tryRawFallback(binding, view)
  if (raw) return raw

  await binding.surface.prepare()
  const reports = await readSurfaceReports(binding.surface)
  return resolution(binding, view, reports, 'materialization-wait', 'waited for community materialization')
}

function resolution(
  binding: RetrievalCommunitiesBinding,
  view: ViewRevision | undefined,
  reports: readonly CommunityReport[],
  coverage: FreshnessResolution['coverage'],
  coverageBasis: string,
): FreshnessResolution {
  return {
    reports,
    units: reports.map(reportToUnit),
    coverage,
    coverageBasis,
    ...(binding.viewId ? { view: { id: binding.viewId, viewRevision: view?.revisionHash ?? null } } : {}),
    generations: unique(reports.map((report) => report.generationId)),
  }
}

async function tryCompensatedAdditions(
  binding: RetrievalCommunitiesBinding,
  view: ViewRevision | undefined,
): Promise<FreshnessResolution | null> {
  if (!binding.records || !view) return null
  const pointer = await findCompatiblePointer(binding, view)
  if (!pointer) return null
  const previousMembers = new Set(pointer.members.map((member) => member.sourceId))
  const additions = view.members.filter((member) => !previousMembers.has(member.sourceId))
  if (additions.length === 0) return null
  const rawUnits = await rawUnitsForMembers(binding.records, binding, additions.map((member) => member.sourceId), 'compensated-addition')
  if (charCount(rawUnits) > GLOBAL_SEARCH_BATCH_BUDGET) return null
  const reports = await readReportsForPointer(binding.records, binding, pointer)
  return {
    reports,
    units: [...reports.map(reportToUnit), ...rawUnits],
    coverage: 'compensated',
    coverageBasis: 'older view generation plus direct mapping over added sources',
    view: { id: binding.viewId ?? 'view', viewRevision: view.revisionHash },
    generations: unique([pointer.generationId, ...rawUnits.map((unit) => unit.generationId)]),
  }
}

async function tryRawFallback(
  binding: RetrievalCommunitiesBinding,
  view: ViewRevision | undefined,
): Promise<FreshnessResolution | null> {
  if (!binding.records) return null
  const sourceIds = view?.members.map((member) => member.sourceId)
  const rawUnits = await rawUnitsForMembers(binding.records, binding, sourceIds, 'raw-fallback')
  if (charCount(rawUnits) > GLOBAL_SEARCH_BATCH_BUDGET) return null
  return {
    reports: [],
    units: rawUnits,
    coverage: 'raw-fallback',
    coverageBasis: 'direct mapping over current evidence because no usable community generation was available',
    ...(binding.viewId ? { view: { id: binding.viewId, viewRevision: view?.revisionHash ?? null } } : {}),
    generations: unique(rawUnits.map((unit) => unit.generationId)),
  }
}

async function findCompatiblePointer(
  binding: RetrievalCommunitiesBinding,
  view: ViewRevision,
): Promise<(CommunityGenerationPointerRecord & { readonly members: ViewRevision['members'] }) | null> {
  if (!binding.records) return null
  const pointers = await allCurrentPointers(binding.records, binding)
  const currentMembers = new Map(view.members.map((member) => [member.sourceId, member.contentHash]))
  for (const pointer of pointers.sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (pointer.viewRevision === view.revisionHash || pointer.viewRevision === null) continue
    const members = await loadPointerMembers(binding, pointer)
    if (!members) continue
    const compatible = members.every((member) => currentMembers.get(member.sourceId) === member.contentHash)
    if (compatible && members.length < view.members.length) return { ...pointer, members }
  }
  return null
}

async function loadPointerMembers(binding: RetrievalCommunitiesBinding, pointer: CommunityGenerationPointerRecord) {
  if (!binding.records || !binding.viewId || !pointer.viewRevision) return null
  const key = `${indexedNamespacePrefix(binding.indexerId, binding.namespace)}view:${binding.viewId}:revision:${pointer.viewRevision}`
  const record = await binding.records.get(key)
  return isRecord(record) && Array.isArray(record.members)
    ? record.members.flatMap((member) => isRecord(member) && typeof member.sourceId === 'string' && typeof member.contentHash === 'string'
        ? [{ sourceId: member.sourceId, contentHash: member.contentHash }]
        : [])
    : null
}

async function allCurrentPointers(records: RecordStore, binding: RetrievalCommunitiesBinding) {
  const prefix = `${indexedNamespacePrefix(binding.indexerId, binding.namespace)}communities:`
  const entries = await listAll(records, prefix)
  return entries.flatMap((entry) => {
    if (!entry.key.endsWith(':current')) return []
    const pointer = asCommunityGenerationPointerRecord(entry.value)
    return pointer?.strategyFingerprint === binding.strategyFingerprint ? [pointer] : []
  })
}

async function readSurfaceReports(surface: RetrievalCommunitiesBinding['surface']): Promise<readonly CommunityReport[]> {
  const reports: CommunityReport[] = []
  let cursor: string | undefined
  do {
    const page = await surface.reports({ cursor, limit: 100 })
    reports.push(...page.reports)
    cursor = page.cursor
  } while (cursor)
  return reports
}

async function readReportsForPointer(records: RecordStore, binding: RetrievalCommunitiesBinding, pointer: CommunityGenerationPointerRecord) {
  const entries = await listAll(records, communityReportPrefix(binding.indexerId, binding.namespace, pointer.scopeKey, pointer.generationId))
  return entries.flatMap((entry) => isRecord(entry.value) ? [entry.value as unknown as CommunityReport] : [])
}

async function rawUnitsForMembers(records: RecordStore, binding: RetrievalCommunitiesBinding, sourceIds: readonly string[] | undefined, generationId: string) {
  const allowed = sourceIds ? new Set(sourceIds) : undefined
  const entries = await listAll(records, indexedNamespacePrefix(binding.indexerId, binding.namespace))
  return entries.flatMap((entry): SearchUnit[] => {
    const hit = indexedChunkToHit({ value: entry.value, score: 1 })
    if (!hit || hit.kind === 'finding' || allowed && !allowed.has(hit.source.id)) return []
    const id = `raw:${hit.source.id}:${hit.chunkId}`
    return [{
      communityId: id,
      generationId,
      level: 0,
      title: hit.source.id,
      summary: hit.content,
      findings: [{ id, statement: hit.content, supports: [{ kind: 'chunk', sourceId: hit.source.id, chunkId: hit.chunkId }], assertionRefs: [] }],
      lineage: { viewRevision: binding.viewId ? null : null, communityGeneration: generationId, reportCommunityId: id },
    }]
  }).sort((left, right) => left.communityId.localeCompare(right.communityId))
}

function reportToUnit(report: CommunityReport): SearchUnit {
  return {
    communityId: report.communityId,
    generationId: report.generationId,
    level: report.level,
    ...(report.parentCommunityId ? { parentCommunityId: report.parentCommunityId } : {}),
    title: report.title,
    summary: report.summary,
    findings: report.findings.map((finding) => ({
      id: `${report.communityId}:${finding.id}`,
      statement: finding.statement,
      supports: finding.evidence,
      assertionRefs: finding.assertionRefs ?? [],
    })),
    lineage: {
      viewRevision: report.lineage.viewRevision,
      communityGeneration: report.generationId,
      reportCommunityId: report.communityId,
    },
  }
}

function charCount(units: readonly SearchUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.title.length + unit.summary.length + unit.findings.reduce((inner, finding) => inner + finding.statement.length, 0), 0)
}

async function listAll(records: RecordStore, prefix: string): Promise<readonly RecordEntry[]> {
  const entries: RecordEntry[] = []
  let cursor: string | undefined
  do {
    const page = await records.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    cursor = page.cursor
  } while (cursor)
  return entries
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
