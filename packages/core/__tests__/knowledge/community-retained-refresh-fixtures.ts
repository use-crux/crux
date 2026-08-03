import { vi } from 'vitest'
import { communityPrefix, communityScopeKey } from '../../src/knowledge/communities/keys'
import type { KnowledgeModel } from '../../src/knowledge'
import type { CruxChunk } from '../../src/indexing'
import type { JsonObject, RecordStore } from '../../src/storage'

export function chunk(
  namespace: string,
  sourceId: string,
  chunkId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal: 0, content, metadata }
}

export function countingModel() {
  let relationCalls = 0
  let reportCallCount = 0
  let searchCallCount = 0
  const model = {
    name: 'community-retained-refresh-test',
    fingerprint: 'community-retained-refresh-test-v1',
    generateText: vi.fn(async () => ({ text: '' })),
    generateObject: vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) {
        relationCalls += 1
        return { object: entityOutput(args.prompt) }
      }
      if (args.system?.includes('connected-knowledge findings')) {
        searchCallCount += 1
        return { object: { findings: searchFindings(args.prompt) } }
      }
      reportCallCount += 1
      return { object: reportOutput(args.prompt, reportCallCount) }
    }),
    relationCalls: () => relationCalls,
    reportCalls: () => reportCallCount,
    searchCalls: () => searchCallCount,
    reset: () => {
      relationCalls = 0
      reportCallCount = 0
      searchCallCount = 0
    },
  } satisfies KnowledgeModel & CountingControls
  return model
}

export function blockingCountingModel() {
  const model = countingModel()
  let reportStarted: (() => void) | undefined
  let releaseReports: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve
  })
  const gate = new Promise<void>((resolve) => {
    releaseReports = resolve
  })
  const baseGenerateObject = model.generateObject
  model.generateObject = vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
    if (
      !args.prompt.includes('Extract canonical entity names') &&
      !args.system?.includes('connected-knowledge findings')
    ) {
      const result = await baseGenerateObject(args)
      reportStarted?.()
      await gate
      return result
    }
    return baseGenerateObject(args)
  }) as typeof model.generateObject
  return Object.assign(model, {
    waitForReport: () => started,
    releaseReports: () => releaseReports?.(),
  })
}

export async function publishedGenerationIds(
  records: RecordStore,
  indexerId: string,
  strategyFingerprint: string,
): Promise<readonly string[]> {
  const scopeKey = communityScopeKey({ strategyFingerprint })
  const page = await records.list(communityPrefix(indexerId, indexerId, scopeKey), { limit: 100 })
  return [...new Set(page.entries.flatMap((entry) => {
    const value = entry.value as JsonObject
    return typeof value.generationId === 'string' && entry.key.includes(':gen:') ? [value.generationId] : []
  }))].sort()
}

interface CountingControls {
  relationCalls(): number
  reportCalls(): number
  searchCalls(): number
  reset(): void
}

function entityOutput(prompt: string) {
  const mentions = [...prompt.matchAll(/\[([^\]]+)\]([^\[]+)/g)].flatMap((match) => {
    const chunkId = match[1] ?? ''
    const text = match[2] ?? ''
    return ['Alpha', 'Beta', 'Gamma'].filter((name) => text.includes(name)).map((name) => ({ chunkId, name }))
  })
  const names = [...new Set(mentions.map((item) => item.name))].sort()
  return { mentions, related: names.slice(1).map((name) => ({ from: names[0] ?? name, to: name })) }
}

function reportOutput(prompt: string, index: number) {
  const evidence = evidenceFromPrompt(prompt)
  return {
    title: `Community ${index}`,
    summary: `Summary ${index}`,
    findings: evidence.length > 0 ? [{ statement: `Finding ${index}`, evidence }] : [],
  }
}

function searchFindings(prompt: string) {
  const parsed = JSON.parse(prompt) as { communities: Array<{ communityId: string; findings: Array<{ id: string; statement: string }> }> }
  return parsed.communities.flatMap((community) =>
    community.findings.slice(0, 1).map((finding) => ({
      statement: finding.statement,
      findingIds: [finding.id],
      score: 90,
    })),
  )
}

function evidenceFromPrompt(prompt: string) {
  const matches = [...prompt.matchAll(/chunk:([^:\s,\]]+):([^,\]\s]+)/g)]
  return matches.length > 0
    ? [{ kind: 'chunk' as const, sourceId: matches[0]?.[1] ?? '', chunkId: matches[0]?.[2] ?? '' }]
    : []
}
