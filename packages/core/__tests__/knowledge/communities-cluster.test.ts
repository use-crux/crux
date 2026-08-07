import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { indexedChunkKey } from '../../src/indexed-knowledge/keys'
import { stableHash } from '../../src/indexing/hash'
import type { CruxChunk } from '../../src/indexing'
import {
  COMMUNITY_INPUT_BUDGET,
  clusterKnowledgeCommunities,
  type CommunityChunkInput,
  type CommunityGraphInput,
} from '../../src/knowledge/communities/cluster'
import { buildCommunityGraphInput } from '../../src/knowledge/communities/graph-input'
import { assertionEntityEdges, projectAssertionCommunities } from '../../src/knowledge/communities/assertion-policy'
import { createKnowledgeGenerationStore } from '../../src/knowledge/generation'
import { knowledgeAssertionsItemKey } from '../../src/knowledge/keys'
import { createKnowledgeEdgeRecord, createKnowledgeEntityRecord, type KnowledgeEdgeRecord } from '../../src/knowledge/records'
import { encodeKnowledgeRef, type KnowledgeRef } from '../../src/knowledge/refs'
import { inMemoryStorage, type RecordStore } from '../../src/storage'
const indexerId = 'docs'
const namespace = 'kb'

describe('knowledge community clustering', () => {
  it('projects assertion support, entity affinity, relation weights, and deterministic memberships', () => {
    const chunks = [
      chunkInput('source-a', 'a', 1, 'alpha'),
      chunkInput('source-a', 'b', 2, 'bravo charlie'),
      chunkInput('source-b', 'c', 1, 'delta'),
    ]
    const projection = projectAssertionCommunities({
      chunks,
      mentionWeights: [
        { chunkRef: chunkRef('source-a', 'a'), entityId: 'alpha', weight: 1 },
        { chunkRef: chunkRef('source-a', 'b'), entityId: 'bravo', weight: 1 },
        { chunkRef: chunkRef('source-a', 'b'), entityId: 'charlie', weight: 1 },
        { chunkRef: chunkRef('source-b', 'c'), entityId: 'delta', weight: 1 },
      ],
      assertions: [
        assertion('assertion:a', ['source-a:a', 'source-a:b']),
        assertion('assertion:b', ['source-a:b']),
        assertion('assertion:c', ['source-b:c']),
      ],
      relations: [
        { relationId: 'relation:1', type: 'supersedes', fromAssertionId: 'assertion:a', toAssertionId: 'assertion:b' },
      ],
      leafByChunk: new Map([
        ['chunk:source-a:a', 'leaf:z'],
        ['chunk:source-a:b', 'leaf:a'],
        ['chunk:source-b:c', 'leaf:c'],
      ]),
    })

    expect(projection.supports).toEqual([
      { assertionId: 'assertion:a', chunkRef: chunkRef('source-a', 'a'), weight: 0.5 / Math.sqrt(2) },
      { assertionId: 'assertion:a', chunkRef: chunkRef('source-a', 'b'), weight: 0.5 / Math.sqrt(2) },
      { assertionId: 'assertion:b', chunkRef: chunkRef('source-a', 'b'), weight: 1 / Math.sqrt(2) },
      { assertionId: 'assertion:c', chunkRef: chunkRef('source-b', 'c'), weight: 1 },
    ])
    expect(projection.entityAffinities).toEqual([
      { assertionId: 'assertion:a', entityId: 'alpha', weight: 0.5 / Math.sqrt(2) },
      { assertionId: 'assertion:a', entityId: 'bravo', weight: 0.25 / Math.sqrt(2) },
      { assertionId: 'assertion:a', entityId: 'charlie', weight: 0.25 / Math.sqrt(2) },
      { assertionId: 'assertion:b', entityId: 'bravo', weight: 0.5 / Math.sqrt(2) },
      { assertionId: 'assertion:b', entityId: 'charlie', weight: 0.5 / Math.sqrt(2) },
      { assertionId: 'assertion:c', entityId: 'delta', weight: 1 },
    ])
    expect(projection.relations).toEqual([expect.objectContaining({ relationId: 'relation:1', weight: 1.25 / Math.sqrt(2) })])
    expect(projection.memberships).toEqual([
      { assertionId: 'assertion:a', primaryCommunityId: 'leaf:a', secondaryCommunityIds: ['leaf:z'] },
      { assertionId: 'assertion:b', primaryCommunityId: 'leaf:a', secondaryCommunityIds: [] },
      { assertionId: 'assertion:c', primaryCommunityId: 'leaf:c', secondaryCommunityIds: [] },
    ])
  })

  it('assigns one primary and deterministic report-only secondary membership per visible assertion', () => {
    const base: CommunityGraphInput = {
      ...graph({
        entities: [],
        chunks: [chunkInput('a', 'one', 1, 'a'.repeat(13_000)), chunkInput('b', 'two', 1, 'b'.repeat(13_000))],
        mentions: [], edges: [],
      }),
      assertions: [
        assertion('assertion:visible', ['a:one', 'b:two']),
        assertion('assertion:hidden', ['hidden:none']),
      ],
      assertionRelations: [],
    }
    const first = clusterKnowledgeCommunities(base)
    const second = clusterKnowledgeCommunities({
      ...base,
      chunks: [...base.chunks].reverse(),
      assertions: [...(base.assertions ?? [])].reverse(),
    })

    expect(assertionMembershipSignature(first)).toEqual(assertionMembershipSignature(second))
    expect(first.leaves.filter((leaf) => leaf.primaryAssertionIds.includes('assertion:visible'))).toHaveLength(1)
    expect(first.leaves.filter((leaf) => leaf.secondaryAssertionIds.includes('assertion:visible'))).toHaveLength(1)
    expect(first.communities.flatMap((community) => [...community.primaryAssertionIds, ...community.secondaryAssertionIds]))
      .not.toContain('assertion:hidden')
  })

  it('uses assertion relations for affinity without merging assertions from a shared source alone', () => {
    const chunks = [chunkInput('shared', 'alpha', 1, 'alpha'), chunkInput('shared', 'bravo', 2, 'bravo')]
    const mentionWeights = [
      { chunkRef: chunkRef('shared', 'alpha'), entityId: 'alpha', weight: 1 },
      { chunkRef: chunkRef('shared', 'bravo'), entityId: 'bravo', weight: 1 },
    ]
    const assertions = [assertion('assertion:alpha', ['shared:alpha']), assertion('assertion:bravo', ['shared:bravo'])]
    const base = { chunks, mentionWeights, assertions, leafByChunk: new Map<string, string>() }

    expect(assertionEntityEdges({ ...base, relations: [] })).toEqual([])
    expect(assertionEntityEdges({ ...base, relations: [{
      relationId: 'relation:support', type: 'supports',
      fromAssertionId: 'assertion:alpha', toAssertionId: 'assertion:bravo',
    }] })).toEqual([{ leftEntityId: 'alpha', rightEntityId: 'bravo', weight: 1 / Math.sqrt(2) }])

    const related = clusterKnowledgeCommunities({
      namespace, entities: ['alpha', 'bravo'].map((entityId) => ({ entityId, canonicalName: entityId })),
      chunks, mentionWeights, residualChunks: [], edges: [], assertions,
      assertionRelations: [{ relationId: 'relation:support', type: 'supports', fromAssertionId: 'assertion:alpha', toAssertionId: 'assertion:bravo' }],
    })
    expect(related.leaves.filter((leaf) => leaf.entityIds.length > 0).map((leaf) => leaf.entityIds)).toEqual([['alpha', 'bravo']])
  })

  it('clusters mention-free assertion nodes, supports, and relations without collapsing them into entity edges', () => {
    const chunks = ['alpha', 'bravo', 'charlie'].map((id, ordinal) =>
      chunkInput('source', id, ordinal, id[0]?.repeat(9_000) ?? ''))
    const input: CommunityGraphInput = {
      namespace, entities: [], edges: [], chunks, mentionWeights: [], residualChunks: chunks,
      assertions: [
        assertion('assertion:alpha', ['source:alpha']),
        assertion('assertion:charlie', ['source:charlie']),
      ],
      assertionRelations: [{
        relationId: 'relation:linked', type: 'supports',
        fromAssertionId: 'assertion:alpha', toAssertionId: 'assertion:charlie',
      }],
    }

    const clustered = clusterKnowledgeCommunities(input)
    const paired = clustered.leaves.find((leaf) => leaf.chunkRefs.length === 2)
    expect(paired?.chunkRefs.map((ref) => ref.chunkId)).toEqual(['alpha', 'charlie'])
    expect(paired?.primaryAssertionIds).toEqual(['assertion:alpha', 'assertion:charlie'])
    expect(signature(clusterKnowledgeCommunities({
      ...input,
      chunks: [...input.chunks].reverse(),
      residualChunks: [...input.residualChunks].reverse(),
      assertions: [...(input.assertions ?? [])].reverse(),
    }))).toEqual(signature(clustered))
  })

  it('uses every assertion support when splitting bounded leaf components', () => {
    const chunks = ['alpha', 'bravo', 'charlie'].map((id) =>
      chunkInput(id, 'evidence', 0, id.repeat(1_800)))
    const result = clusterKnowledgeCommunities({
      namespace, entities: [], edges: [], chunks, mentionWeights: [], residualChunks: chunks,
      assertions: [assertion('assertion:shared', chunks.map((chunk) => `${chunk.sourceId}:${chunk.chunkId}`))],
      assertionRelations: [],
    }, 20_000)

    expect(result.leaves.map((leaf) => leaf.chunkRefs.map((ref) => ref.sourceId)).sort()).toEqual([
      ['alpha', 'bravo'],
      ['charlie'],
    ])
  })

  it('connects bounded leaf components through cross-source assertion relations', () => {
    const chunks = [
      chunkInput('left', 'evidence', 0, 'left'),
      chunkInput('right', 'evidence', 0, 'right'),
    ]
    const result = clusterKnowledgeCommunities({
      namespace, entities: [], edges: [], chunks, mentionWeights: [], residualChunks: chunks,
      assertions: [
        assertion('assertion:left', ['left:evidence']),
        assertion('assertion:right', ['right:evidence']),
      ],
      assertionRelations: [{
        relationId: 'relation:cross-source', type: 'supports',
        fromAssertionId: 'assertion:left', toAssertionId: 'assertion:right',
      }],
    })

    expect(result.leaves).toHaveLength(1)
    expect(result.leaves[0]?.chunkRefs.map((ref) => ref.sourceId)).toEqual(['left', 'right'])
  })

  it('is deterministic across identical and permuted graph inputs', () => {
    const input = graph({
      entities: ['charlie', 'alpha', 'bravo'],
      chunks: [
        chunkInput('s', 'c2', 2, 'bravo charlie'),
        chunkInput('s', 'c1', 1, 'alpha bravo'),
        chunkInput('s', 'c3', 3, 'residual'),
      ],
      mentions: [
        ['s', 'c2', 'charlie', 1],
        ['s', 'c1', 'bravo', 1],
        ['s', 'c1', 'alpha', 1],
        ['s', 'c2', 'bravo', 1],
      ],
      edges: [['alpha', 'bravo', 2], ['bravo', 'charlie', 1]],
    })
    const permuted = graph({
      entities: ['bravo', 'charlie', 'alpha'],
      chunks: [...input.chunks].reverse(),
      mentions: [...input.mentionWeights].reverse().map((mention) => [
        mention.chunkRef.sourceId,
        mention.chunkRef.chunkId,
        mention.entityId,
        mention.weight,
      ]),
      edges: [['bravo', 'charlie', 1], ['bravo', 'alpha', 2]],
    })

    expect(signature(clusterKnowledgeCommunities(input))).toEqual(signature(clusterKnowledgeCommunities(input)))
    expect(signature(clusterKnowledgeCommunities(permuted))).toEqual(signature(clusterKnowledgeCommunities(input)))
  })

  it('assigns every visible chunk to exactly one leaf', () => {
    const input = graph({
      entities: ['alpha', 'bravo'],
      chunks: [
        chunkInput('s1', 'mentioned', 1, 'alpha'),
        chunkInput('s1', 'unmentioned', 2, 'no entity'),
        chunkInput('s2', 'alone', 1, 'standalone'),
      ],
      mentions: [['s1', 'mentioned', 'alpha', 1]],
      edges: [],
    })

    const result = clusterKnowledgeCommunities(input)
    const assigned = result.leaves.flatMap((leaf) => leaf.chunkRefs.map(encodeKnowledgeRef))
    const visible = input.chunks.map((chunk) => encodeKnowledgeRef(chunk.ref)).sort()

    expect([...assigned].sort()).toEqual(visible)
    expect(new Set(assigned).size).toBe(visible.length)
  })

  it('keeps leaf report input within the budget for splittable inputs', () => {
    const huge = 'x'.repeat(COMMUNITY_INPUT_BUDGET + 1)
    const result = clusterKnowledgeCommunities(graph({
      entities: ['alpha', 'bravo', 'charlie'],
      chunks: [
        chunkInput('s', 'a', 1, 'a'.repeat(8_000)),
        chunkInput('s', 'b', 2, 'b'.repeat(8_000)),
        chunkInput('s', 'c', 3, 'c'.repeat(8_000)),
        chunkInput('s', 'r1', 4, 'r'.repeat(12_000)),
        chunkInput('s', 'r2', 5, 'r'.repeat(12_000)),
      ],
      mentions: [['s', 'a', 'alpha', 1], ['s', 'b', 'bravo', 1], ['s', 'c', 'charlie', 1]],
      edges: [['alpha', 'bravo', 3], ['bravo', 'charlie', 2]],
    }))

    expect(result.leaves.every((leaf) => leaf.estimatedInputChars <= COMMUNITY_INPUT_BUDGET)).toBe(true)
    expect(() => clusterKnowledgeCommunities(graph({ entities: [], chunks: [chunkInput('s', 'huge', 1, huge)], mentions: [], edges: [] })))
      .toThrow(/exceeds the input budget/)
    expect(() => clusterKnowledgeCommunities(graph({ entities: ['alpha'], chunks: [chunkInput('s', 'huge', 1, huge)], mentions: [['s', 'huge', 'alpha', 1]], edges: [] })))
      .toThrow(/exceeds the input budget/)
  })

  it('isolates namespaces and pinned view members while assembling graph input', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, namespace, [
      cruxChunk('member', 'm1', 1, 'member mentions alpha'),
      cruxChunk('outside', 'o1', 1, 'outside mentions beta'),
    ])
    await persistChunks(records, 'other', [cruxChunk('foreign', 'f1', 1, 'foreign', 'other')])
    await publish(records, namespace, 'gen-1', [
      entity('gen-1', 'alpha'),
      entity('gen-1', 'beta'),
    ], [
      edge('gen-1', 'mentions', chunkRef('member', 'm1'), entityRef('alpha'), [chunkRef('member', 'm1')]),
      edge('gen-1', 'mentions', chunkRef('outside', 'o1'), entityRef('beta'), [chunkRef('outside', 'o1')]),
      edge('gen-1', 'related', entityRef('alpha'), entityRef('beta'), [chunkRef('outside', 'o1')]),
    ])

    const input = await buildCommunityGraphInput({
      records,
      indexerId,
      namespace,
      viewMembers: [{ sourceId: 'member', contentHash: await sourceContentHash(records, 'member', 'm1') }],
    })
    const result = clusterKnowledgeCommunities(input)

    expect(input.chunks.map((chunk) => chunk.sourceId)).toEqual(['member'])
    expect(input.entities.map((item) => item.entityId)).toEqual(['alpha'])
    expect(result.leaves.flatMap((leaf) => leaf.entityIds)).not.toContain('beta')
    await expect(buildCommunityGraphInput({
      records,
      indexerId,
      namespace,
      viewMembers: [{ sourceId: 'member', contentHash: 'stale' }],
    })).resolves.toMatchObject({ chunks: [], entities: [] })
  })

  it('reprojects assertions against visible admissible view support', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, namespace, [
      cruxChunk('member', 'm1', 1, 'member evidence'),
      cruxChunk('outside', 'o1', 1, 'outside evidence'),
    ])
    await publish(records, namespace, 'gen-assertions', [], [])
    await records.put(knowledgeAssertionsItemKey(indexerId, namespace, 'facts', 'gen-assertions', 'assertion:both'), {
      _cruxRecordType: 'knowledge-assertion', assertionId: 'assertion:both', type: 'fact', data: { value: 'both' },
      evidence: [support('member', 'm1'), support('outside', 'o1')], provenance: 'exact', stageId: 'facts',
      stageVersion: 1, stageFingerprint: 'facts-v1', generationId: 'gen-assertions', namespace, createdAt: 1, updatedAt: 1,
    })
    await records.put(knowledgeAssertionsItemKey(indexerId, namespace, 'facts', 'gen-assertions', 'assertion:outside'), {
      _cruxRecordType: 'knowledge-assertion', assertionId: 'assertion:outside', type: 'fact', data: { value: 'outside' },
      evidence: [support('outside', 'o1')], provenance: 'exact', stageId: 'facts', stageVersion: 1,
      stageFingerprint: 'facts-v1', generationId: 'gen-assertions', namespace, createdAt: 1, updatedAt: 1,
    })

    const input = await buildCommunityGraphInput({
      records, indexerId, namespace,
      viewMembers: [{ sourceId: 'member', contentHash: await sourceContentHash(records, 'member', 'm1') }],
    })
    const result = clusterKnowledgeCommunities(input)

    expect(result.leaves.flatMap((leaf) => leaf.primaryAssertionIds)).toEqual(['assertion:both'])
    expect(result.communities.flatMap((community) => community.primaryAssertionIds)).not.toContain('assertion:outside')
  })

  it('ignores malformed persisted assertion records', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, namespace, [cruxChunk('member', 'm1', 1, 'member evidence')])
    await publish(records, namespace, 'gen-malformed', [], [])
    const base = {
      _cruxRecordType: 'knowledge-assertion', type: 'fact', data: { value: 'bad' },
      evidence: [support('member', 'm1')], provenance: 'exact', stageId: 'facts', stageVersion: 1,
      stageFingerprint: 'facts-v1', generationId: 'gen-malformed', namespace, createdAt: 1, updatedAt: 1,
    }
    const { data: _data, ...withoutData } = base
    await records.put(knowledgeAssertionsItemKey(indexerId, namespace, 'facts', 'gen-malformed', 'bad-data'), {
      ...withoutData, assertionId: 'bad-data',
    } as never)
    await records.put(knowledgeAssertionsItemKey(indexerId, namespace, 'facts', 'gen-malformed', 'bad-support'), {
      ...base, assertionId: 'bad-support', evidence: [{ sourceId: 'member', chunkRef: { kind: 'entity', entityId: 'x' }, provenance: 'exact' }],
    } as never)
    await records.put(knowledgeAssertionsItemKey(indexerId, namespace, 'facts', 'gen-malformed', 'bad-metadata'), {
      ...base, assertionId: 'bad-metadata', stageVersion: '1',
    } as never)

    await expect(buildCommunityGraphInput({ records, indexerId, namespace })).resolves.toMatchObject({ assertions: [] })
  })

  it('ignores malformed relation types and deduplicates assertion identities', () => {
    const evidence = chunkInput('member', 'm1', 1, 'member evidence')
    const valid = assertion('assertion:duplicate', ['member:m1'])
    const base: CommunityGraphInput = {
      ...graph({ entities: [], chunks: [evidence], mentions: [], edges: [] }),
      assertions: [valid],
      assertionRelations: [],
    }
    const duplicated = {
      ...base,
      assertions: [valid, { ...valid }],
      assertionRelations: [{
        relationId: 'relation:bad', type: 'unknown',
        fromAssertionId: valid.assertionId, toAssertionId: valid.assertionId,
      } as never],
    }

    expect(assertionMembershipSignature(clusterKnowledgeCommunities(duplicated)))
      .toEqual(assertionMembershipSignature(clusterKnowledgeCommunities(base)))
  })

  it('gives assertion-only leaves distinct identities', () => {
    const ids = ['one', 'two', 'three', 'four']
    const chunks = ids.map((id, index) => chunkInput('source', id, index + 1, id))
    const result = clusterKnowledgeCommunities({
      ...graph({ entities: [], chunks, mentions: [], edges: [] }),
      assertions: ids.map((id) => assertion(`assertion:${id}`, [`source:${id}`])),
      assertionRelations: [['one', 'two'], ['three', 'four']].map(([from, to]) => ({
        relationId: `relation:${from}-${to}`, type: 'supersedes' as const,
        fromAssertionId: `assertion:${from}`, toAssertionId: `assertion:${to}`,
      })),
    }, 500)
    const assertionLeaves = result.leaves.filter((leaf) => leaf.entityIds.length === 0 && leaf.chunkRefs.length === 0)

    expect(assertionLeaves.length).toBeGreaterThan(0)
    expect(assertionLeaves.map((leaf) => leaf.communityId)).not.toContain(`community_${stableHash({ members: [] })}`)
    expect(new Set(assertionLeaves.map((leaf) => leaf.communityId)).size).toBe(assertionLeaves.length)
    expect(assertionLeaves.every((leaf) => leaf.memberIdentities.some((id) => id.startsWith('assertion:')))).toBe(true)
  })

  it('splits oversized components deterministically by strongest valid merge', () => {
    const input = graph({
      entities: ['alpha', 'bravo', 'charlie'],
      chunks: [
        chunkInput('s', 'a', 1, 'a'.repeat(10_000)),
        chunkInput('s', 'b', 2, 'b'.repeat(10_000)),
        chunkInput('s', 'c', 3, 'c'.repeat(10_000)),
      ],
      mentions: [['s', 'a', 'alpha', 1], ['s', 'b', 'bravo', 1], ['s', 'c', 'charlie', 1]],
      edges: [['alpha', 'bravo', 10], ['bravo', 'charlie', 9], ['alpha', 'charlie', 1]],
    })

    const entityLeaves = clusterKnowledgeCommunities(input).leaves
      .filter((leaf) => leaf.entityIds.length > 0)
      .map((leaf) => leaf.entityIds)
      .sort()

    expect(entityLeaves).toEqual([['alpha', 'bravo'], ['charlie']])
    expect(signature(clusterKnowledgeCommunities({ ...input, entities: [...input.entities].reverse() }))).toEqual(
      signature(clusterKnowledgeCommunities(input)),
    )
  })

  it('creates per-source fallback leaves in ordinal budget order', () => {
    const result = clusterKnowledgeCommunities(graph({
      entities: [],
      chunks: [
        chunkInput('source', 'third', 3, '3'.repeat(10_000)),
        chunkInput('source', 'first', 1, '1'.repeat(10_000)),
        chunkInput('source', 'second', 2, '2'.repeat(10_000)),
      ],
      mentions: [],
      edges: [],
    }))

    expect(result.leaves.map((leaf) => leaf.chunkRefs.map((ref) => ref.chunkId))).toEqual([
      ['first', 'second'],
      ['third'],
    ])
  })

  it('keeps community ids stable when entity membership is unchanged', () => {
    const first = clusterKnowledgeCommunities(graph({
      entities: ['alpha', 'bravo'],
      chunks: [chunkInput('s', 'one', 1, 'short')],
      mentions: [['s', 'one', 'alpha', 1]],
      edges: [['alpha', 'bravo', 1]],
    }))
    const second = clusterKnowledgeCommunities(graph({
      entities: ['alpha', 'bravo'],
      chunks: [chunkInput('s', 'one', 1, 'changed text')],
      mentions: [['s', 'one', 'alpha', 1]],
      edges: [['alpha', 'bravo', 1]],
    }))

    expect(entityLeafIds(first)).toEqual(entityLeafIds(second))
  })
})

function graph(input: {
  readonly entities: readonly string[]
  readonly chunks: readonly CommunityChunkInput[]
  readonly mentions: readonly (readonly [string, string, string, number])[]
  readonly edges: readonly (readonly [string, string, number])[]
}): CommunityGraphInput {
  const mentionWeights = input.mentions.map(([sourceId, chunkId, entityId, weight]) => ({
    chunkRef: chunkRef(sourceId, chunkId),
    entityId,
    weight,
  }))
  const mentioned = new Set(mentionWeights.map((mention) => encodeKnowledgeRef(mention.chunkRef)))
  return {
    namespace,
    entities: input.entities.map((entityId) => ({ entityId, canonicalName: entityId })),
    chunks: input.chunks,
    mentionWeights,
    residualChunks: input.chunks.filter((chunk) => !mentioned.has(encodeKnowledgeRef(chunk.ref))),
    edges: input.edges.map(([leftEntityId, rightEntityId, weight]) => ({ leftEntityId, rightEntityId, weight })),
  }
}

function signature(result: ReturnType<typeof clusterKnowledgeCommunities>) {
  return result.communities.map((community) => ({
    id: community.communityId,
    kind: community.kind,
    parent: community.parentCommunityId ?? null,
    children: community.childCommunityIds,
    entities: community.entityIds,
    chunks: community.chunkRefs.map(encodeKnowledgeRef),
  }))
}

function entityLeafIds(result: ReturnType<typeof clusterKnowledgeCommunities>): readonly string[] {
  return result.leaves.filter((leaf) => leaf.entityIds.length > 0).map((leaf) => leaf.communityId).sort()
}

function assertionMembershipSignature(result: ReturnType<typeof clusterKnowledgeCommunities>) {
  return result.leaves.map((leaf) => ({
    id: leaf.communityId,
    primary: leaf.primaryAssertionIds,
    secondary: leaf.secondaryAssertionIds,
  })).sort((left, right) => left.id.localeCompare(right.id))
}

async function persistChunks(records: RecordStore, ns: string, chunks: readonly CruxChunk[]): Promise<void> {
  await createIndexedKnowledgeStore({ records, indexerId, namespace: ns }).persistGeneration({
    chunks,
    parents: [],
    replaceSources: true,
    now: 1,
  })
}

async function sourceContentHash(records: RecordStore, sourceId: string, chunkId: string): Promise<string> {
  const record = await records.get(indexedChunkKey(indexerId, namespace, sourceId, chunkId))
  if (!record) throw new Error('Missing indexed chunk.')
  return stableHash([{
    chunkId: record.chunkId,
    generationId: record.generationId,
    content: record.content,
    metadata: record.metadata,
  }])
}

async function publish(
  records: RecordStore,
  ns: string,
  generationId: string,
  entities: readonly ReturnType<typeof entity>[],
  edges: readonly KnowledgeEdgeRecord[],
): Promise<void> {
  const generations = createKnowledgeGenerationStore({ records, indexerId, namespace: ns, retention: 'retain-inactive' })
  const writer = generations.beginGeneration(generationId)
  for (const item of entities) await writer.putEntity(item)
  for (const item of edges) await writer.putEdge(item)
  await writer.finish()
  await generations.publish(generationId)
}
function entity(generationId: string, entityId: string) {
  return createKnowledgeEntityRecord({ entityId, canonicalName: entityId, aliases: [], generationId, namespace })
}

function edge(
  generationId: string,
  type: string,
  from: KnowledgeRef,
  to: KnowledgeRef,
  evidence: readonly ReturnType<typeof chunkRef>[],
): KnowledgeEdgeRecord {
  return createKnowledgeEdgeRecord({
    type,
    from,
    to,
    direction: type === 'related' ? 'symmetric' : 'directed',
    evidence: evidence.map((chunk) => ({ sourceId: chunk.sourceId, chunkRef: chunk, provenance: 'exact' })),
    stageId: 'test',
    stageVersion: 1,
    generationId,
    namespace,
    now: 1,
  })
}

function chunkInput(sourceId: string, chunkId: string, ordinal: number, content: string): CommunityChunkInput {
  return { ref: chunkRef(sourceId, chunkId), sourceId, chunkId, ordinal, content }
}

function cruxChunk(sourceId: string, chunkId: string, ordinal: number, content: string, ns = namespace): CruxChunk {
  return { namespace: ns, sourceId, chunkId, ordinal, content, metadata: {} }
}

function chunkRef(sourceId: string, chunkId: string) {
  return { kind: 'chunk' as const, sourceId, chunkId }
}

function assertion(assertionId: string, supports: readonly string[]) {
  return {
    assertionId,
    type: 'fact',
    data: { statement: assertionId },
    evidence: supports.map((support) => {
      const [sourceId, chunkId] = support.split(':')
      if (!sourceId || !chunkId) throw new Error('Invalid assertion support fixture.')
      return { sourceId, chunkRef: chunkRef(sourceId, chunkId), provenance: 'exact' as const }
    }),
  }
}

function support(sourceId: string, chunkId: string) {
  return { sourceId, chunkRef: chunkRef(sourceId, chunkId), provenance: 'exact' as const }
}

function entityRef(entityId: string): KnowledgeRef {
  return { kind: 'entity', entityId }
}
