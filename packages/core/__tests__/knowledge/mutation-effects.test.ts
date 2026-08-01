import { describe, expect, it, vi } from 'vitest'
import { evidence, flow } from '../../src'
import { embedding } from '../../src/embedding'
import { rollback, rollbackOnError } from '../../src/effect'
import { effectLedger } from '../../src/effect/internal/ledger'
import { corpus, indexer, indexingPipeline, type CruxChunk, type CruxDocument } from '../../src/indexing'
import { communities, knowledgeBase } from '../../src/knowledge'
import type { KnowledgeModel } from '../../src/knowledge/model'
import { relate } from '../../src/knowledge/relate/relate'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { inMemoryStorage } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import type { EffectReceipt } from '../../src/effect'

describe('knowledgeBase mutation effects', () => {
  it('records direct index, reindex, and remove receipts with evidence', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({ id: 'docs-effects', storage, embeddings: topicEmbedding() })
    const run = await flow('kb-direct-mutations', async (scope) =>
      scope.step('mutate', async () => {
        await docs.index([chunk('alpha', 'a1', 'Alpha'), chunk('beta', 'b1', 'Beta')])
        await docs.reindex([chunk('alpha', 'a2', 'Alpha changed')])
        await docs.remove('alpha')
        const receipts = effectLedger.receiptsFor(scope.effects.id)
        return { receipts, views: await inspectReceipts(receipts) }
      }),
    ).run()

    expect(run.status).toBe('completed')
    if (run.status !== 'completed') return
    expect(run.output.receipts).toHaveLength(3)
    expect(run.output.receipts.map((receipt) => receipt.effectId)).toEqual([
      'knowledge.base.index',
      'knowledge.base.reindex',
      'knowledge.base.remove',
    ])
    expect(run.output.receipts[0]).toMatchObject({
      effectKind: 'native',
      nativePrimitive: 'indexing.pipeline',
      outcome: 'succeeded',
      recovery: 'unavailable',
      resource: expect.arrayContaining([
        { type: 'knowledge-base', id: 'docs-effects', namespace: 'docs-effects', attributes: expect.objectContaining({ operation: 'index', sourceCount: 2, chunkCount: 2 }) },
        { type: 'knowledge-base.source', id: 'alpha', namespace: 'docs-effects', attributes: expect.objectContaining({ action: 'indexed' }) },
        { type: 'knowledge-base.source', id: 'beta', namespace: 'docs-effects', attributes: expect.objectContaining({ action: 'indexed' }) },
      ]),
    })
    expect(run.output.receipts[1]).toMatchObject({ outcome: 'succeeded', recovery: 'irreversible' })
    expect(run.output.receipts[2]).toMatchObject({ outcome: 'succeeded', recovery: 'irreversible' })
    expect(intentResource(run.output.views[0])).toEqual(expect.arrayContaining([
      { type: 'knowledge-base', id: 'docs-effects', namespace: 'docs-effects', attributes: expect.objectContaining({ operation: 'index' }) },
    ]))
  })

  it('records corpus sync receipts with operation-specific recovery', async () => {
    const storage = inMemoryStorage()
    const backing = indexer({ id: 'corpus-effects', namespace: 'corpus-effects', storage })
    const sources = corpus({ id: 'corpus-effects', namespace: 'corpus-effects', records: storage.records, indexer: backing })
    const docs = knowledgeBase({ id: 'corpus-effects', storage, corpus: sources })
    const run = await flow('kb-corpus-mutations', async (scope) =>
      scope.step('sync', async () => {
        await docs.index([doc('one', 'One')])
        await docs.reindex([doc('two', 'Two')])
        const receipts = effectLedger.receiptsFor(scope.effects.id)
        return { receipts, views: await inspectReceipts(receipts) }
      }),
    ).run()

    expect(run.status).toBe('completed')
    if (run.status !== 'completed') return
    expect(run.output.receipts).toHaveLength(2)
    expect(run.output.receipts).toMatchObject([
      { effectId: 'knowledge.base.corpus.sync', nativePrimitive: 'corpus.sync', recovery: 'unavailable' },
      { effectId: 'knowledge.base.corpus.sync', nativePrimitive: 'corpus.sync', recovery: 'irreversible' },
    ])
    expect(intentResource(run.output.views[1])).toEqual(expect.arrayContaining([
      { type: 'knowledge-base.source', id: 'two', namespace: 'corpus-effects', attributes: expect.objectContaining({ action: 'added' }) },
      { type: 'knowledge-base.source', id: 'one', namespace: 'corpus-effects', attributes: expect.objectContaining({ action: 'deleted' }) },
    ]))
  })

  it('settles the mutation receipt before derived work fails', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({
      id: 'derive-fails',
      storage,
      pipeline: indexingPipeline({ derive: [throwingRelationStage()] }),
    })
    const run = await flow('kb-derived-failure', async (scope) =>
      scope.step('index', async () => {
        await expect(docs.index([chunk('alpha', 'a1', 'Alpha', 'derive-fails')])).rejects.toThrow('derive exploded')
        return effectLedger.receiptsFor(scope.effects.id)
      }),
    ).run()

    expect(run.status).toBe('completed')
    if (run.status !== 'completed') return
    expect(run.output).toHaveLength(1)
    expect(run.output[0]).toMatchObject({
      effectId: 'knowledge.base.index',
      outcome: 'succeeded',
    })
  })

  it('does not record effects for retrieval or community materialization', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({
      id: 'read-effects',
      storage,
      embeddings: topicEmbedding(),
      communities: communities({ model: communityModel() }),
    })
    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.', 'read-effects')])

    const run = await flow('kb-non-mutations', async (scope) =>
      scope.step('read-and-materialize', async () => {
        await docs.retriever({ limit: 1 }).retrieve('Alpha')
        await docs.communities?.prepare()
        await docs.communities?.reports({ limit: 10 })
        return effectLedger.receiptsFor(scope.effects.id)
      }),
    ).run()

    expect(run.status).toBe('completed')
    if (run.status !== 'completed') return
    expect(run.output).toEqual([])
  })

  it('uses native recovery errors without custom effect duplicate-id registration', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({ id: 'recovery-effects', storage })
    await expect(rollbackOnError(async () => docs.index([chunk('alpha', 'a1', 'Alpha', 'recovery-effects')]))).rejects.toMatchObject({
      code: 'EFFECT_RECOVERY_REQUIRED',
    })

    const scopeRef = await rollbackOnError(
      async (scope) => {
        await docs.index([chunk('alpha', 'a1', 'Alpha', 'recovery-effects')])
        await docs.index([chunk('alpha', 'a2', 'Alpha again', 'recovery-effects')])
        expect(effectLedger.receiptsFor(scope.ref.id)).toHaveLength(2)
        return scope.ref
      },
      { recovery: 'best-effort' },
    )
    await expect(rollback(scopeRef)).resolves.toMatchObject({
      status: 'not_possible',
      units: [
        { effectIds: ['knowledge.base.index'], status: 'unavailable' },
        { effectIds: ['knowledge.base.index'], status: 'unavailable' },
      ],
    })
  })
})

async function inspectReceipts(receipts: readonly EffectReceipt[]) {
  return Promise.all(receipts.map((receipt) => evidence.inspect(receiptRef(receipt), { includeData: true })))
}

function intentResource(view: Awaited<ReturnType<typeof inspectReceipts>>[number] | undefined) {
  const data = view?.roles.intent.records[0]?.data
  return data && typeof data === 'object' && 'resource' in data ? data.resource : undefined
}

function receiptRef(receipt: EffectReceipt) {
  return { kind: 'effect.receipt' as const, id: receipt.id, effectId: receipt.effectId }
}

function doc(sourceId: string, content: string): CruxDocument {
  return { namespace: 'corpus-effects', sourceId, content, metadata: {} }
}

function chunk(sourceId: string, chunkId: string, content: string, namespace = 'docs-effects'): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal: 0, content, metadata: {} }
}

function throwingRelationStage() {
  return relate({
    id: 'throws',
    version: 1,
    types: { mentions: { from: ['chunk'], to: ['chunk'], direction: 'directed', description: 'test' } },
    run: () => {
      throw new Error('derive exploded')
    },
  })
}

function topicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'topic',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => textOf(input).includes('Alpha') ? [1, 0] : [0, 1]),
  })
}

function communityModel(): KnowledgeModel {
  return {
    name: 'community-effects',
    fingerprint: 'community-effects-v1',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async (args: { readonly prompt: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) return { object: entityOutput(args.prompt) }
      return { object: reportOutput(args.prompt) }
    }),
  }
}

function entityOutput(prompt: string) {
  const mentions = [...prompt.matchAll(/\[([^\]]+)\]([^\[]+)/g)].flatMap((match) => {
    const chunkId = match[1] ?? ''
    const text = match[2] ?? ''
    return ['Alpha', 'Beta'].filter((name) => text.includes(name)).map((name) => ({ chunkId, name }))
  })
  const names = [...new Set(mentions.map((item) => item.name))].sort()
  return { mentions, related: names.slice(1).map((name) => ({ from: names[0] ?? name, to: name })) }
}

function reportOutput(prompt: string) {
  const evidence = evidenceFromPrompt(prompt)
  return { title: 'Community', summary: 'Summary', findings: evidence.length > 0 ? [{ statement: 'Finding', evidence }] : [] }
}

function evidenceFromPrompt(prompt: string): KnowledgeRef[] {
  const match = [...prompt.matchAll(/chunk:([^:\s,\]]+):([^,\]\s]+)/g)][0]
  return match ? [{ kind: 'chunk', sourceId: match[1] ?? '', chunkId: match[2] ?? '' }] : []
}
