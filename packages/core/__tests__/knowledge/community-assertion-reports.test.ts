import { describe, expect, it, vi } from 'vitest'
import { COMMUNITY_INPUT_BUDGET, clusterKnowledgeCommunities, type CommunityGraphInput } from '../../src/knowledge/communities/cluster'
import { generateCommunityReports } from '../../src/knowledge/communities/reports'
import type { KnowledgeModel } from '../../src/knowledge/model'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'

describe('assertion-aware community reports', () => {
  it('includes canonical assertions and relations, validates refs, and deduplicates parent counts', async () => {
    const prompts: string[] = []
    const graph = assertionGraph()
    const clustering = clusterKnowledgeCommunities(graph)
    const model = reportModel(prompts)
    const reports = await generateCommunityReports({
      model,
      generationId: 'community-generation',
      graph,
      clustering,
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })

    const leaves = reports.filter((report) => report.level === 0)
    const root = reports.find((report) => report.communityId === clustering.rootCommunityId)
    expect(leaves.map((report) => report.counts.assertions).sort()).toEqual([1, 2])
    expect(root?.counts).toEqual({ entities: 0, chunks: 2, assertions: 2 })
    expect(prompts.join('\n')).toContain('Canonical assertions are validated claims; raw evidence chunks are source text.')
    expect(prompts.join('\n')).toContain('[assertion:shared] fact:')
    expect(prompts.join('\n')).toContain('boundary: supports assertion:shared -> assertion:remote')
    expect(reports.flatMap((report) => report.findings.flatMap((finding) => finding.assertionRefs ?? [])))
      .toEqual(expect.arrayContaining([{ assertionId: 'assertion:shared' }]))
  })

  it('rejects finding assertion refs outside the report projection', async () => {
    const graph = assertionGraph()
    const clustering = clusterKnowledgeCommunities(graph)
    const model = reportModel([], 'assertion:unknown')

    await expect(generateCommunityReports({
      model,
      generationId: 'community-generation',
      graph,
      clustering,
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })).rejects.toBeInstanceOf(ValidationExhaustedError)
    expect(model.generateObject).toHaveBeenCalledTimes(2)
    expect((model.generateObject as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].prompt)
      .toContain('findings.[0].assertionRefs.[0].assertionId: custom')
  })

  it('omits relations unless both assertion endpoints remain visible after support filtering', async () => {
    const graph = assertionGraph()
    const filtered = { ...graph, chunks: graph.chunks.slice(0, 1) }
    const prompts: string[] = []
    await generateCommunityReports({
      model: reportModel(prompts), generationId: 'community-generation', graph: filtered,
      clustering: clusterKnowledgeCommunities(filtered),
      lineage: { viewRevision: 'filtered', graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })

    expect(prompts.join('\n')).not.toContain('assertion:remote')
    expect(prompts.join('\n')).not.toContain('supports assertion:shared -> assertion:remote')
  })

  it('reuses identical normalized assertion projections across input permutations', async () => {
    const graph = assertionGraph()
    const clustering = clusterKnowledgeCommunities(graph)
    const first = await generateCommunityReports({
      model: reportModel([]), generationId: 'first', graph, clustering,
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })
    const prior = new Map(first.map((report) => [report.communityId, report]))
    const prompts: string[] = []
    const permuted = {
      ...graph,
      chunks: [...graph.chunks].reverse(),
      assertions: [...(graph.assertions ?? [])].reverse().map((assertion) => ({ ...assertion, evidence: [...assertion.evidence].reverse() })),
      assertionRelations: [...(graph.assertionRelations ?? [])].reverse(),
    }
    const second = await generateCommunityReports({
      model: reportModel(prompts), generationId: 'second', graph: permuted,
      clustering: clusterKnowledgeCommunities(permuted),
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
      findReusable: async (communityId, memberHash) => {
        const report = prior.get(communityId)
        return report?.lineage.memberHash === memberHash ? report : null
      },
    })

    expect(prompts).toEqual([])
    expect(second.map((report) => report.title)).toEqual(first.map((report) => report.title))
  })

  it('keeps generated leaf prompts within the input budget after assertion projection', async () => {
    const chunks = ['left', 'right'].map((sourceId) => ({
      ref: chunkRef(sourceId, 'evidence'), sourceId, chunkId: 'evidence', ordinal: 0, content: sourceId,
    }))
    const graph: CommunityGraphInput = {
      namespace: 'docs', entities: [], edges: [], chunks, mentionWeights: [], residualChunks: chunks,
      assertions: Array.from({ length: 20 }, (_, index) => ({
        assertionId: `assertion:${index.toString().padStart(2, '0')}`, type: 'fact',
        data: { statement: String(index).repeat(1_200) },
        evidence: [support(chunks[index % 2]!.ref)],
      })),
      assertionRelations: Array.from({ length: 19 }, (_, index) => ({
        relationId: `relation:${index.toString().padStart(2, '0')}`, type: 'supports' as const,
        fromAssertionId: `assertion:${index.toString().padStart(2, '0')}`,
        toAssertionId: `assertion:${(index + 1).toString().padStart(2, '0')}`,
      })),
    }
    const prompts: string[] = []

    const clustering = clusterKnowledgeCommunities(graph)
    await generateCommunityReports({
      model: reportModel(prompts), generationId: 'bounded', graph,
      clustering,
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })

    expect(clustering.leaves.length).toBeGreaterThan(1)
    const leafPrompts = prompts.filter((prompt) => prompt.includes('Canonical assertions'))
    expect(leafPrompts.length).toBeGreaterThan(0)
    expect(leafPrompts.every((prompt) => prompt.length <= COMMUNITY_INPUT_BUDGET)).toBe(true)
  })

  it('reuses a view report when only filtered-out assertion supports change', async () => {
    const visible = chunkRef('visible', 'one')
    const hidden = chunkRef('hidden', 'two')
    const graph: CommunityGraphInput = {
      namespace: 'docs', entities: [], edges: [],
      chunks: [{ ref: visible, sourceId: 'visible', chunkId: 'one', ordinal: 0, content: 'Visible.' }],
      mentionWeights: [], residualChunks: [],
      assertions: [{
        assertionId: 'assertion:view', type: 'fact', data: { statement: 'Visible' },
        evidence: [support(visible), support(hidden)],
      }],
      assertionRelations: [],
    }
    const clustering = clusterKnowledgeCommunities(graph)
    const first = await generateCommunityReports({
      model: reportModel([]), generationId: 'first', graph, clustering,
      lineage: { viewRevision: 'view', graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })
    const prior = new Map(first.map((report) => [report.communityId, report]))
    const prompts: string[] = []
    const changed = {
      ...graph,
      assertions: graph.assertions?.map((assertion) => ({
        ...assertion,
        evidence: [support(visible), { ...support(hidden), provenance: 'derived' as const }],
      })),
    }

    await generateCommunityReports({
      model: reportModel(prompts), generationId: 'second', graph: changed, clustering,
      lineage: { viewRevision: 'view', graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
      findReusable: async (communityId, memberHash) => {
        const report = prior.get(communityId)
        return report?.lineage.memberHash === memberHash ? report : null
      },
    })

    expect(prompts).toEqual([])
  })

  it('invalidates parent reuse when normalized child evidence or assertion refs change', async () => {
    const graph = assertionGraph()
    const clustering = clusterKnowledgeCommunities(graph)
    const first = await generateCommunityReports({
      model: reportModel([]), generationId: 'first', graph, clustering,
      lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
    })
    const prior = new Map(first.map((report) => [report.communityId, report]))
    const parentHashWith = async (change: 'evidence' | 'assertionRefs') => {
      let parentHash = ''
      await generateCommunityReports({
        model: reportModel([]), generationId: change, graph, clustering,
        lineage: { viewRevision: null, graphGeneration: 'graph-generation', strategyFingerprint: 'strategy' },
        findReusable: async (communityId, memberHash) => {
          const report = prior.get(communityId)
          if (!report) return null
          if (report.level > 0) {
            if (communityId === clustering.rootCommunityId) parentHash = memberHash
            return null
          }
          return {
            ...report,
            findings: report.findings.map((finding) => ({
              ...finding,
              ...(change === 'evidence' ? { evidence: [chunkRef('changed', 'evidence')] } : {}),
              ...(change === 'assertionRefs' ? { assertionRefs: [{ assertionId: 'assertion:changed' }] } : {}),
            })),
          }
        },
      })
      return parentHash
    }

    const priorHash = prior.get(clustering.rootCommunityId)?.lineage.memberHash
    await expect(parentHashWith('evidence')).resolves.not.toBe(priorHash)
    await expect(parentHashWith('assertionRefs')).resolves.not.toBe(priorHash)
  })
})

function assertionGraph(): CommunityGraphInput {
  const left = chunkRef('left', 'one')
  const right = chunkRef('right', 'two')
  return {
    namespace: 'docs',
    entities: [],
    edges: [],
    chunks: [
      { ref: left, sourceId: 'left', chunkId: 'one', ordinal: 0, content: 'Left evidence.'.repeat(1_100) },
      { ref: right, sourceId: 'right', chunkId: 'two', ordinal: 0, content: 'Right evidence.'.repeat(1_100) },
    ],
    mentionWeights: [],
    residualChunks: [],
    assertions: [
      { assertionId: 'assertion:shared', type: 'fact', data: { statement: 'Shared' }, evidence: [support(left), support(right)] },
      { assertionId: 'assertion:remote', type: 'fact', data: { statement: 'Remote' }, evidence: [support(right)] },
    ],
    assertionRelations: [{
      relationId: 'relation:boundary', type: 'supports',
      fromAssertionId: 'assertion:shared', toAssertionId: 'assertion:remote',
    }],
  }
}

function reportModel(prompts: string[], assertionId?: string) {
  return {
    name: 'assertion-report-test',
    fingerprint: 'assertion-report-test-v1',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async (args: { readonly prompt: string }) => {
      prompts.push(args.prompt)
      const match = args.prompt.match(/chunk:([^:\s,\]]+):([^,\]\s]+)/)
      const visibleAssertionId = assertionId ?? args.prompt.match(/\[(assertion:[^\]]+)\]/)?.[1]
      return { object: {
        title: 'Community', summary: 'Summary', findings: match ? [{
          statement: 'Finding',
          evidence: [{ kind: 'chunk', sourceId: match[1], chunkId: match[2] }],
          ...(visibleAssertionId ? { assertionRefs: [{ assertionId: visibleAssertionId }] } : {}),
        }] : [],
      } }
    }),
  } satisfies KnowledgeModel
}

function chunkRef(sourceId: string, chunkId: string) {
  return { kind: 'chunk' as const, sourceId, chunkId }
}

function support(chunk: ReturnType<typeof chunkRef>) {
  return { sourceId: chunk.sourceId, chunkRef: chunk, provenance: 'exact' as const }
}
