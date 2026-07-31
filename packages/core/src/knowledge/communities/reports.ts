/**
 * Bottom-up report generation for connected knowledge communities.
 *
 * @module
 */

import { stableHash } from '../../indexing/hash'
import type { CruxChunk } from '../../indexing'
import type { AssetStore } from '../../storage'
import { generateObjectWithEvidence } from '../derive/modality-validation'
import type { KnowledgeModel } from '../model'
import { encodeKnowledgeRef, type KnowledgeRef } from '../refs'
import type { CommunityGraphInput, KnowledgeCommunity, KnowledgeCommunityClustering } from './cluster'
import {
  createCommunityReportRecord,
  type CommunityReport,
  type CommunityReportLineage,
} from './records'
import { communityReportOutputSchema, type CommunityReportOutput } from './report-schema'

export interface GenerateCommunityReportsInput {
  readonly model: KnowledgeModel
  readonly generationId: string
  readonly graph: CommunityGraphInput
  readonly clustering: KnowledgeCommunityClustering
  readonly lineage: Omit<CommunityReportLineage, 'memberHash'>
  readonly assets?: AssetStore
  readonly findReusable?: (
    communityId: string,
    memberHash: string,
    strategyFingerprint: string,
  ) => Promise<CommunityReport | null>
}

/** Generate one validated report for each clustered community. */
export async function generateCommunityReports(
  input: GenerateCommunityReportsInput,
): Promise<readonly CommunityReport[]> {
  const reports = new Map<string, CommunityReport>()
  const communities = [...input.clustering.communities].sort(compareBottomUp)

  for (const community of communities) {
    const children = community.childCommunityIds.flatMap((id) => {
      const child = reports.get(id)
      return child ? [child] : []
    })
    const memberHash = memberHashFor(community, input.graph, children)
    const reusable = await input.findReusable?.(
      community.communityId,
      memberHash,
      input.lineage.strategyFingerprint,
    )
    if (reusable) {
      reports.set(community.communityId, cloneForGeneration(reusable, input.generationId, input.lineage))
      continue
    }

    const output = await readReportOutput({
      model: input.model,
      community,
      graph: input.graph,
      children,
      ...(input.assets ? { assets: input.assets } : {}),
    })
    reports.set(community.communityId, toReport(input, community, output, children, memberHash))
  }

  return [...reports.values()].sort((left, right) => left.level - right.level || left.communityId.localeCompare(right.communityId))
}

async function readReportOutput(input: {
  readonly model: KnowledgeModel
  readonly community: KnowledgeCommunity
  readonly graph: CommunityGraphInput
  readonly children: readonly CommunityReport[]
  readonly assets?: AssetStore
}): Promise<CommunityReportOutput> {
  const prompt = renderReportPrompt(input.community, input.graph, input.children)
  const chunks = reportChunks(input.community, input.graph, input.children)
  const first = await generateObjectWithEvidence({
    model: input.model,
    system: 'Return a community report that matches the requested schema.',
    prompt,
    schema: communityReportOutputSchema,
    sourceId: sourceIdsFor(chunks).join(', '),
    chunks,
    subject: `community "${input.community.communityId}"`,
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const parsed = communityReportOutputSchema.safeParse(first.object)
  if (parsed.success) return parsed.data

  const repaired = await generateObjectWithEvidence({
    model: input.model,
    system: 'Return a corrected community report that matches the requested schema.',
    prompt: `${prompt}\n\nFix these validation errors:\n${parsed.error.issues.map((issue) => issue.message).join('\n')}`,
    schema: communityReportOutputSchema,
    sourceId: sourceIdsFor(chunks).join(', '),
    chunks,
    subject: `community "${input.community.communityId}"`,
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const repairParsed = communityReportOutputSchema.safeParse(repaired.object)
  if (repairParsed.success) return repairParsed.data
  throw new Error(`Community "${input.community.communityId}" report failed validation after repair: ${repairParsed.error.message}`)
}

function toReport(
  input: GenerateCommunityReportsInput,
  community: KnowledgeCommunity,
  output: CommunityReportOutput,
  children: readonly CommunityReport[],
  memberHash: string,
): CommunityReport {
  const fallbackEvidence = defaultEvidence(community, children)
  return createCommunityReportRecord({
    communityId: community.communityId,
    generationId: input.generationId,
    level: community.level,
    ...(community.parentCommunityId !== undefined ? { parentCommunityId: community.parentCommunityId } : {}),
    title: output.title,
    summary: output.summary,
    findings: output.findings.map((finding, index) => ({
      id: finding.id ?? `finding-${index + 1}`,
      statement: finding.statement,
      evidence: finding.evidence.length > 0 ? finding.evidence : fallbackEvidence,
      ...(finding.assertionRefs ? { assertionRefs: finding.assertionRefs } : {}),
    })),
    lineage: {
      ...input.lineage,
      memberHash,
    },
    counts: countsFor(community, children),
  })
}

function memberHashFor(
  community: KnowledgeCommunity,
  graph: CommunityGraphInput,
  children: readonly CommunityReport[],
): string {
  if (children.length > 0) {
    return stableHash(children.map((child) => ({
      communityId: child.communityId,
      memberHash: child.lineage.memberHash,
      findings: child.findings.map((finding) => finding.statement),
    })))
  }
  const chunkByKey = new Map(graph.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  const entityById = new Map(graph.entities.map((entity) => [entity.entityId, entity]))
  return stableHash({
    members: community.memberIdentities,
    entities: community.entityIds.map((id) => entityById.get(id) ?? { entityId: id }),
    chunks: community.chunkRefs.map((ref) => {
      const chunk = chunkByKey.get(encodeKnowledgeRef(ref))
      return chunk ? { ref, content: chunk.content } : { ref }
    }),
  })
}

function renderReportPrompt(
  community: KnowledgeCommunity,
  graph: CommunityGraphInput,
  children: readonly CommunityReport[],
): string {
  if (children.length > 0) {
    return [
      `Community: ${community.communityId}`,
      'Use only these child findings as evidence.',
      children.flatMap((child) => child.findings.map((finding) =>
        `- ${finding.statement}\n  evidence: ${finding.evidence.map(encodeKnowledgeRef).join(', ')}`,
      )).join('\n'),
    ].join('\n\n')
  }
  const chunkByKey = new Map(graph.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  const chunks = community.chunkRefs.flatMap((ref) => {
    const chunk = chunkByKey.get(encodeKnowledgeRef(ref))
    return chunk ? [`[${encodeKnowledgeRef(ref)}] ${bound(chunk.content, 1_200)}`] : []
  })
  const entities = community.entityIds.map((id) => {
    const entity = graph.entities.find((item) => item.entityId === id)
    return entity ? `${entity.canonicalName}: ${entity.description ?? ''}` : id
  })
  return [
    `Community: ${community.communityId}`,
    'Write findings supported only by the listed evidence refs.',
    entities.length ? `Entities:\n${entities.join('\n')}` : '',
    chunks.length ? `Evidence:\n${chunks.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

function reportChunks(
  community: KnowledgeCommunity,
  graph: CommunityGraphInput,
  children: readonly CommunityReport[],
): readonly CruxChunk[] {
  if (children.length > 0) return []
  const chunkByKey = new Map(graph.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  return community.chunkRefs.flatMap((ref) => {
    const chunk = chunkByKey.get(encodeKnowledgeRef(ref))
    return chunk
      ? [{
          namespace: graph.namespace,
          sourceId: chunk.sourceId,
          chunkId: chunk.chunkId,
          ordinal: chunk.ordinal,
          content: chunk.content,
          metadata: {},
          ...(chunk.source ? { source: chunk.source } : {}),
        }]
      : []
  })
}

function sourceIdsFor(chunks: readonly CruxChunk[]): readonly string[] {
  return [...new Set(chunks.map((chunk) => chunk.sourceId))].sort()
}

function cloneForGeneration(
  report: CommunityReport,
  generationId: string,
  lineage: Omit<CommunityReportLineage, 'memberHash'>,
): CommunityReport {
  return createCommunityReportRecord({
    ...report,
    generationId,
    lineage: { ...lineage, memberHash: report.lineage.memberHash },
  })
}

function defaultEvidence(community: KnowledgeCommunity, children: readonly CommunityReport[]): readonly KnowledgeRef[] {
  const childEvidence = children.flatMap((child) => child.findings.flatMap((finding) => finding.evidence))
  return childEvidence.length > 0 ? dedupeRefs(childEvidence) : community.chunkRefs
}

function countsFor(community: KnowledgeCommunity, children: readonly CommunityReport[]) {
  if (children.length > 0) {
    return {
      entities: children.reduce((sum, child) => sum + child.counts.entities, 0),
      chunks: children.reduce((sum, child) => sum + child.counts.chunks, 0),
      assertions: children.reduce((sum, child) => sum + child.counts.assertions, 0),
    }
  }
  return { entities: community.entityIds.length, chunks: community.chunkRefs.length, assertions: 0 }
}

function dedupeRefs(refs: readonly KnowledgeRef[]): readonly KnowledgeRef[] {
  return [...new Map(refs.map((ref) => [encodeKnowledgeRef(ref), ref])).values()]
}

function compareBottomUp(left: KnowledgeCommunity, right: KnowledgeCommunity): number {
  return left.level - right.level || left.communityId.localeCompare(right.communityId)
}

function bound(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
