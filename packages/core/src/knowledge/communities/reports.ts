/**
 * Bottom-up report generation for connected knowledge communities.
 *
 * @module
 */

import { stableHash } from '../../indexing/hash'
import { z } from 'zod'
import type { CruxChunk } from '../../indexing'
import type { AssetStore } from '../../storage'
import { generateObjectWithEvidence } from '../derive/modality-validation'
import type { KnowledgeModel } from '../model'
import { generateObjectWithDomainRepair } from '../structured-domain-repair'
import { encodeKnowledgeRef, type KnowledgeRef } from '../refs'
import type { CommunityGraphInput, KnowledgeCommunity, KnowledgeCommunityClustering } from './cluster'
import {
  createCommunityReportRecord,
  type CommunityReport,
  type CommunityReportLineage,
} from './records'
import { communityReportOutputSchema, type CommunityReportOutput } from './report-schema'
import { ASSERTION_MEMBERSHIP_POLICY_VERSION, ASSERTION_REPORT_PROMPT_VERSION, projectAssertionCommunities } from './assertion-policy'

const MAX_BOUNDARY_RELATIONS = 20

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
  const projection = reportProjection(input.community, input.graph)
  const prompt = renderReportPrompt(input.community, input.graph, input.children, projection)
  const chunks = reportChunks(input.community, input.graph, input.children, projection.assertionIds)
  const sourceId = sourceIdsFor(chunks).join(', ')
  const subject = `community "${input.community.communityId}"`
  const promptId = `community:${input.community.communityId}`

  return generateObjectWithDomainRepair({
    promptId,
    initial: () => generateObjectWithEvidence({
      model: input.model,
      system: 'Return a community report that matches the requested schema.',
      prompt,
      schema: communityReportOutputSchema,
      sourceId,
      chunks,
      subject,
      ...(input.assets ? { assets: input.assets } : {}),
    }),
    repair: (safeFeedback) => generateObjectWithEvidence({
      model: input.model,
      system: 'Return a corrected community report that matches the requested schema.',
      prompt: `${prompt}\n\nFix these validation errors:\n${safeFeedback}`,
      schema: communityReportOutputSchema,
      sourceId,
      chunks,
      subject,
      ...(input.assets ? { assets: input.assets } : {}),
    }),
    accept: (object) => {
      const parsed = communityReportOutputSchema.safeParse(object)
      if (parsed.success) {
        const available = new Set(projection.assertionIds)
        const unknown = parsed.data.findings.flatMap((finding, findingIndex) =>
          (finding.assertionRefs ?? []).flatMap((ref, refIndex) => available.has(ref.assertionId) ? [] : [{ findingIndex, refIndex, id: ref.assertionId }]))
        if (unknown.length > 0) {
          return { ok: false, zodErrors: new z.ZodError(unknown.map((item) => ({
            code: 'custom' as const,
            path: ['findings', item.findingIndex, 'assertionRefs', item.refIndex, 'assertionId'],
            message: `Unknown report assertion reference: ${item.id}`,
          }))) }
        }
      }
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, zodErrors: parsed.error }
    },
  })
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
    counts: countsFor(community),
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
    policy: ASSERTION_MEMBERSHIP_POLICY_VERSION,
    reportPrompt: ASSERTION_REPORT_PROMPT_VERSION,
    members: community.memberIdentities,
    entities: community.entityIds.map((id) => entityById.get(id) ?? { entityId: id }),
    chunks: community.chunkRefs.map((ref) => {
      const chunk = chunkByKey.get(encodeKnowledgeRef(ref))
      return chunk ? { ref, content: chunk.content } : { ref }
    }),
    assertions: reportProjection(community, graph).assertions,
    relations: reportProjection(community, graph).relations,
  })
}

function renderReportPrompt(
  community: KnowledgeCommunity,
  graph: CommunityGraphInput,
  children: readonly CommunityReport[],
  projection: ReturnType<typeof reportProjection>,
): string {
  if (children.length > 0) {
    return [
      `Community: ${community.communityId}`,
      'Use only these child findings as evidence.',
      children.flatMap((child) => child.findings.map((finding) =>
        `- ${finding.statement}\n  evidence: ${finding.evidence.map(encodeKnowledgeRef).join(', ')}\n  assertions: ${(finding.assertionRefs ?? []).map((ref) => ref.assertionId).join(', ')}`,
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
    'Canonical assertions are validated claims; raw evidence chunks are source text. Write findings supported only by the listed evidence refs and cite relevant assertion IDs in assertionRefs.',
    entities.length ? `Entities:\n${entities.join('\n')}` : '',
    chunks.length ? `Evidence:\n${chunks.join('\n')}` : '',
    projection.assertions.length ? `Assertions:\n${projection.assertions.map((assertion) =>
      `[${assertion.assertionId}] ${assertion.type}: ${JSON.stringify(assertion.data)}`).join('\n')}` : '',
    projection.relations.length ? `Assertion relations:\n${projection.relations.map((relation) =>
      `${relation.presentation}: ${relation.type} ${relation.fromAssertionId} -> ${relation.toAssertionId}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

function reportChunks(
  community: KnowledgeCommunity,
  graph: CommunityGraphInput,
  children: readonly CommunityReport[],
  assertionIds: readonly string[],
): readonly CruxChunk[] {
  if (children.length > 0) return []
  const chunkByKey = new Map(graph.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  const assertionSet = new Set(assertionIds)
  const assertionRefs = (graph.assertions ?? []).filter((assertion) => assertionSet.has(assertion.assertionId))
    .flatMap((assertion) => assertion.evidence.map((support) => support.chunkRef))
  const refs = dedupeRefs([...community.chunkRefs, ...assertionRefs]).filter((ref): ref is Extract<KnowledgeRef, { kind: 'chunk' }> => ref.kind === 'chunk')
  return refs.flatMap((ref) => {
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

function countsFor(community: KnowledgeCommunity) {
  return {
    entities: new Set(community.entityIds).size,
    chunks: new Set(community.chunkRefs.map(encodeKnowledgeRef)).size,
    assertions: new Set([...community.primaryAssertionIds, ...community.secondaryAssertionIds]).size,
  }
}

function reportProjection(community: KnowledgeCommunity, graph: CommunityGraphInput) {
  const assertionIds = [...new Set([...community.primaryAssertionIds, ...community.secondaryAssertionIds])].sort()
  const available = new Set(assertionIds)
  const assertions = (graph.assertions ?? []).filter((assertion) => available.has(assertion.assertionId))
    .map((assertion) => ({ ...assertion, evidence: [...assertion.evidence].sort((left, right) =>
      encodeKnowledgeRef(left.chunkRef).localeCompare(encodeKnowledgeRef(right.chunkRef))) }))
    .sort((left, right) => left.assertionId.localeCompare(right.assertionId))
  const visible = new Set(projectAssertionCommunities({
    chunks: graph.chunks,
    mentionWeights: graph.mentionWeights,
    assertions: graph.assertions ?? [],
    relations: graph.assertionRelations ?? [],
    leafByChunk: new Map(),
  }).assertions.map((assertion) => assertion.assertionId))
  const relations = (graph.assertionRelations ?? []).flatMap((relation) => {
    if (!visible.has(relation.fromAssertionId) || !visible.has(relation.toAssertionId)) return []
    const fromHere = available.has(relation.fromAssertionId)
    const toHere = available.has(relation.toAssertionId)
    if (fromHere && toHere) return [{ ...relation, presentation: 'internal' as const }]
    return fromHere || toHere ? [{ ...relation, presentation: 'boundary' as const }] : []
  }).sort((left, right) => left.relationId.localeCompare(right.relationId))
  const internal = relations.filter((relation) => relation.presentation === 'internal')
  const boundary = relations.filter((relation) => relation.presentation === 'boundary').slice(0, MAX_BOUNDARY_RELATIONS)
  return { assertionIds, assertions, relations: [...internal, ...boundary] }
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
