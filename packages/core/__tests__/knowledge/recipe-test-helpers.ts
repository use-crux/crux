import { vi } from 'vitest'
import { adapter, type AdapterResponse, type AdapterSpec, type CallArgs } from '../../src'
import { embedding } from '../../src/embedding'
import type { CruxChunk } from '../../src/indexing'
import { type KnowledgeModel } from '../../src/knowledge'
import { communityScopeKey } from '../../src/knowledge/communities/keys'
import { createCommunityReportRecord, type CommunityReport } from '../../src/knowledge/communities/records'
import { createCommunityStore } from '../../src/knowledge/communities/store'
import { knowledgeCurrentKey } from '../../src/knowledge/keys'
import type { RetrieverHit } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

export function requestHarness(reply?: (args: CallArgs) => string) {
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: 'recipe-use-first-class-test',
    capacity: () => ({ contextWindow: 32_768, defaultOutputReserve: 256, countingConfidence: 'estimated' }),
    async call(_client, args) {
      const text = reply?.(args) ?? 'done'
      return { raw: { text }, extracted: response(text) }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  }
  return { runtime: adapter(spec)({}) }
}

export function response(text: string): AdapterResponse {
  return { text, usage: undefined, finishReason: 'stop', responseId: 'response-1', actualModelId: 'model-1' }
}

export function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'recipe-use-first-class-test',
    dimensions: 2,
    maxInputTokens: 10_000,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 0]),
  })
}

export function knowledgeModel() {
  return {
    name: 'recipe-use-first-class-test',
    fingerprint: 'recipe-use-first-class-test-v1',
    generateText: vi.fn(async () => ({ text: '' })),
    generateObject: vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) {
        return { object: { mentions: [], related: [] } }
      }
      if (args.system?.includes('connected-knowledge findings')) {
        return { object: { findings: searchFindings(args.prompt) } }
      }
      return { object: { title: 'Community', summary: 'Summary', findings: [] } }
    }),
  } satisfies KnowledgeModel
}

function searchFindings(promptText: string) {
  const parsed = JSON.parse(promptText) as { communities: Array<{ findings: Array<{ id: string; statement: string }> }> }
  return parsed.communities.flatMap((community) =>
    community.findings.slice(0, 1).map((finding) => ({ statement: finding.statement, findingIds: [finding.id], score: 90 })),
  )
}

export function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return schema2TextChunk({ namespace: 'docs', sourceId, chunkId, ordinal: 0, content, metadata: {} })
}

export function hit(sourceId: string, content: string): RetrieverHit {
  return { namespace: 'source', source: { id: sourceId }, chunkId: 'main', content, metadata: {}, score: 1, provenance: {} }
}

export function report(communityId: string, generationId: string, statement: string, sourceId: string): CommunityReport {
  return createCommunityReportRecord({
    communityId,
    generationId,
    level: 1,
    title: communityId,
    summary: statement,
    findings: [{ id: 'finding-1', statement, evidence: [{ kind: 'chunk', sourceId, chunkId: 'main' }] }],
    lineage: { viewRevision: null, graphGeneration: 'graph-test', strategyFingerprint: 'strategy-test', memberHash: communityId },
    counts: { entities: 0, chunks: 1, assertions: 0 },
  })
}

export async function publishReports(
  records: ReturnType<typeof inMemoryStorage>['records'],
  strategyFingerprint: string,
  reports: readonly CommunityReport[],
) {
  await records.put(knowledgeCurrentKey('docs', 'docs'), { namespace: 'docs', generationId: 'graph-test' })
  const store = createCommunityStore({
    records,
    indexerId: 'docs',
    namespace: 'docs',
    scopeKey: communityScopeKey({ strategyFingerprint }),
  })
  const generationId = reports[0]?.generationId ?? 'gen-empty'
  const writer = store.begin(generationId)
  for (const item of reports) {
    await writer.putReport({ ...item, lineage: { ...item.lineage, strategyFingerprint } })
    await writer.putLevelIndex({ generationId: item.generationId, communityId: item.communityId, level: item.level })
  }
  await writer.finish()
  await store.publish(generationId, {
    viewRevision: null,
    graphGeneration: 'graph-test',
    strategyFingerprint,
    memberHash: 'root',
  })
}
