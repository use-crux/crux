import { describe, expect, it, vi } from 'vitest'
import { clusterKnowledgeCommunities, type CommunityGraphInput } from '../../src/knowledge/communities/cluster'
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
})

function assertionGraph(): CommunityGraphInput {
  const left = chunkRef('left', 'one')
  const right = chunkRef('right', 'two')
  return {
    namespace: 'docs',
    entities: [],
    edges: [],
    chunks: [
      { ref: left, sourceId: 'left', chunkId: 'one', ordinal: 0, content: 'Left evidence.' },
      { ref: right, sourceId: 'right', chunkId: 'two', ordinal: 0, content: 'Right evidence.' },
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

function reportModel(prompts: string[], assertionId = 'assertion:shared') {
  return {
    name: 'assertion-report-test',
    fingerprint: 'assertion-report-test-v1',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async (args: { readonly prompt: string }) => {
      prompts.push(args.prompt)
      const match = args.prompt.match(/chunk:([^:\s,\]]+):([^,\]\s]+)/)
      return { object: {
        title: 'Community', summary: 'Summary', findings: match ? [{
          statement: 'Finding',
          evidence: [{ kind: 'chunk', sourceId: match[1], chunkId: match[2] }],
          assertionRefs: [{ assertionId }],
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
