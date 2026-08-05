import { z } from 'zod'
import { stableHash } from '../../../indexing/hash'
import type { KnowledgeRef } from '../../../knowledge/refs'
import type { KnowledgeModel } from '../../../knowledge/model'
import { generateObjectWithDomainRepair } from '../../../knowledge/structured-domain-repair'
import type { FindingHit } from '../../types'
import {
  GLOBAL_SEARCH_BATCH_BUDGET,
  type GlobalSearchCandidate,
  type PackedBatch,
  type ResolvedGlobalSearchDetail,
  type SearchFindingSource,
  type SearchUnit,
} from './global-search-types'

const mapOutputSchema = z.object({
  findings: z.array(z.object({
    statement: z.string().min(1),
    findingIds: z.array(z.string().min(1)).min(1),
    score: z.number().finite().min(0).max(100),
  })),
})

export function selectDetail(args: {
  readonly configured: 'auto' | ResolvedGlobalSearchDetail
  readonly query: string
  readonly generations: readonly string[]
  readonly strategyFingerprint: string
  readonly modelFingerprint: string
  readonly scan: string
  readonly limit: number
}): ResolvedGlobalSearchDetail {
  if (args.configured !== 'auto') return args.configured
  const hash = stableHash({
    query: args.query.trim().toLowerCase(),
    generations: args.generations,
    strategyFingerprint: args.strategyFingerprint,
    modelFingerprint: args.modelFingerprint,
    scan: args.scan,
    limit: args.limit,
  })
  return Number.parseInt(hash.slice(-2), 16) % 2 === 0 ? 'overview' : 'detailed'
}

export function filterUnitsByDetail(units: readonly SearchUnit[], detail: ResolvedGlobalSearchDetail): readonly SearchUnit[] {
  const parents = new Set(units.flatMap((unit) => unit.parentCommunityId ? [unit.parentCommunityId] : []))
  return units
    .filter((unit) => detail === 'overview' ? parents.has(unit.communityId) : !parents.has(unit.communityId))
    .sort(compareUnits)
}

export function packBatches(units: readonly SearchUnit[]): readonly PackedBatch[] {
  const batches: PackedBatch[] = []
  let current: SearchUnit[] = []
  let currentChars = 0
  for (const unit of [...units].sort(compareUnits)) {
    const size = unitChars(unit)
    if (current.length > 0 && currentChars + size > GLOBAL_SEARCH_BATCH_BUDGET) {
      batches.push({ index: batches.length, units: current, inputChars: currentChars })
      current = []
      currentChars = 0
    }
    current.push(unit)
    currentChars += size
  }
  if (current.length > 0) batches.push({ index: batches.length, units: current, inputChars: currentChars })
  return batches
}

export async function mapGlobalSearchBatches(args: {
  readonly model: KnowledgeModel
  readonly query: string
  readonly batches: readonly PackedBatch[]
}): Promise<readonly GlobalSearchCandidate[]> {
  const candidates: GlobalSearchCandidate[] = []
  for (const batch of args.batches) {
    const validIds = new Set(batch.units.flatMap((unit) => unit.findings.map((finding) => finding.id)))
    const object = await readBatch(args.model, args.query, batch, validIds)
    candidates.push(...object.findings.map((finding) => ({
      ...finding,
      findingIds: finding.findingIds.slice().sort(),
      communityId: firstCommunityId(finding.findingIds),
    })))
  }
  return candidates
}

export function reduceGlobalSearchCandidates(args: {
  readonly candidates: readonly GlobalSearchCandidate[]
  readonly units: readonly SearchUnit[]
  readonly namespace: string
  readonly limit: number
}): readonly FindingHit[] {
  const byFindingId = new Map(args.units.flatMap((unit) => unit.findings.map((finding) => [finding.id, { unit, finding }])))
  const merged = new Map<string, GlobalSearchCandidate>()
  for (const candidate of args.candidates) {
    const key = candidate.findingIds.slice().sort().join('|')
    const existing = merged.get(key)
    if (!existing || candidate.score > existing.score || candidate.score === existing.score && candidate.communityId < existing.communityId) {
      merged.set(key, candidate)
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score || left.communityId.localeCompare(right.communityId) || left.findingIds.join('|').localeCompare(right.findingIds.join('|')))
    .slice(0, args.limit)
    .map((candidate) => toFindingHit(candidate, byFindingId, args.namespace))
}

function toFindingHit(
  candidate: GlobalSearchCandidate,
  byFindingId: ReadonlyMap<string, { readonly unit: SearchUnit; readonly finding: SearchFindingSource }>,
  namespace: string,
): FindingHit {
  const refs = candidate.findingIds.flatMap((id) => {
    const item = byFindingId.get(id)
    return item ? [item] : []
  })
  const primary = refs[0]
  const supports = dedupeRefs(refs.flatMap((ref) => ref.finding.supports))
  const assertionRefs = dedupeAssertions(refs.flatMap((ref) => ref.finding.assertionRefs))
  const lineage = primary?.unit.lineage ?? { viewRevision: null, communityGeneration: 'unknown', reportCommunityId: candidate.communityId }
  return {
    kind: 'finding',
    namespace,
    content: candidate.statement,
    score: Math.max(0.000001, Math.min(1, candidate.score / 100)),
    citation: {
      findingTarget: `finding:${stableHash({ statement: candidate.statement, ids: candidate.findingIds })}`,
      supports,
      assertionRefs,
      lineage,
    },
  }
}

async function readBatch(
  model: KnowledgeModel,
  query: string,
  batch: PackedBatch,
  validIds: ReadonlySet<string>,
) {
  const basePrompt = renderPrompt(query, batch)
  return generateObjectWithDomainRepair({
    promptId: `globalSearch:batch:${batch.index + 1}`,
    initial: () => model.generateObject({
      system: 'Return relevant connected-knowledge findings matching the schema.',
      prompt: basePrompt,
      schema: mapOutputSchema,
    }),
    repair: (safeFeedback) => model.generateObject({
      system: 'Return corrected relevant connected-knowledge findings matching the schema.',
      prompt: `${basePrompt}\n\nFix these validation errors:\n${safeFeedback}`,
      schema: mapOutputSchema,
    }),
    accept: (object) => acceptMapOutput(object, validIds),
  })
}

function acceptMapOutput(value: unknown, validIds: ReadonlySet<string>) {
  const parsed = mapOutputSchema.safeParse(value)
  if (!parsed.success) return { ok: false as const, zodErrors: parsed.error }
  for (const finding of parsed.data.findings) {
    const invalid = finding.findingIds.find((id) => !validIds.has(id))
    if (invalid) {
      return {
        ok: false as const,
        zodErrors: new z.ZodError([{
          code: 'custom',
          path: ['findings', 'findingIds'],
          message: 'unknown_finding_id',
        }]),
      }
    }
  }
  return { ok: true as const, data: parsed.data }
}

function renderPrompt(query: string, batch: PackedBatch): string {
  return JSON.stringify({
    query,
    communities: batch.units.map((unit) => ({
      communityId: unit.communityId,
      level: unit.level,
      title: unit.title,
      summary: unit.summary,
      findings: unit.findings.map((finding) => ({ id: finding.id, statement: finding.statement })),
    })),
  })
}

function compareUnits(left: SearchUnit, right: SearchUnit): number {
  return left.level - right.level || left.communityId.localeCompare(right.communityId)
}

function firstCommunityId(findingIds: readonly string[]): string {
  return findingIds[0]?.split(':')[0] ?? ''
}

function unitChars(unit: SearchUnit): number {
  return unit.title.length + unit.summary.length + unit.findings.reduce((sum, finding) => sum + finding.statement.length, 0)
}

function dedupeRefs(refs: readonly KnowledgeRef[]): readonly KnowledgeRef[] {
  return [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()]
}

function dedupeAssertions(refs: readonly { readonly assertionId: string }[]) {
  return [...new Map(refs.map((ref) => [ref.assertionId, ref])).values()]
}
