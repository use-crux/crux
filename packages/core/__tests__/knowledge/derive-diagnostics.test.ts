import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { evidence, flow, ValidationExhaustedError } from '../../src'
import type { EffectReceipt } from '../../src/effect'
import { effectLedger } from '../../src/effect/internal/ledger'
import { indexingPipeline, type CruxChunk, type CruxDocument } from '../../src/indexing'
import { assertions, knowledgeBase, relate } from '../../src/knowledge'
import { MAX_DERIVE_BATCH_CHARS } from '../../src/knowledge/derive/bounds'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import type { KnowledgeModel } from '../../src/knowledge/model'
import { inMemoryRecordStore, inMemoryStorage } from '../../src/storage'

const namespace = 'derive-diag'
const chunkRef = { kind: 'chunk' as const, sourceId: 'doc-1', chunkId: 'c1' }
const assertionTypes = {
  fact: z.object({ value: z.string() }),
}
const relationTypes = {
  mentions: {
    from: ['chunk'] as const,
    to: ['chunk'] as const,
    direction: 'directed' as const,
    description: 'Mentions another chunk',
  },
}

describe('connected knowledge derive diagnostics', () => {
  it('receipts oversized chunk truncation with deterministic source, chunk, and length details', async () => {
    const records = inMemoryRecordStore()
    const source = model([{ claims: [] }])
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model: source })
    const oversized = 'x'.repeat(MAX_DERIVE_BATCH_CHARS + 5)

    const result = await runDeriveStages({
      records,
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('doc-1', 'short'),
      chunks: [chunk('doc-1', 'c1', oversized)],
    })

    expect(result[0]?.warnings[0]).toMatch(/Derive refs truncated chunk for source doc-1 chunk c1: 12005 -> \d+ chars\./)
  })

  it('fails assertion extraction when repair still returns invalid claims', async () => {
    const storage = inMemoryStorage()
    const source = model([
      { assertions: [{ type: 'fact', data: { value: 1 }, evidence: [chunkRef], provenance: 'derived' }] },
      { assertions: [{ type: 'fact', data: { value: 1 }, evidence: [chunkRef], provenance: 'derived' }] },
    ])
    const docs = knowledgeBase({
      id: 'kb-assertions',
      storage,
      pipeline: indexingPipeline({ derive: [assertions({ id: 'facts', version: 1, types: assertionTypes, model: source })] }),
    })
    const input = [chunk('doc-1', 'c1', 'Fact', 'kb-assertions')]

    const error = await docs.index(input).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(error).toMatchObject({ attempts: 1, maxAttempts: 1, promptId: 'facts' })
    expect(source.generateObject).toHaveBeenCalledTimes(2)
  })

  it('omits the knowledge field when no connected derive features are configured', async () => {
    const docs = knowledgeBase({ id: 'plain-kb', storage: inMemoryStorage() })

    const result = await docs.index([chunk('doc-1', 'c1', 'Fact', 'plain-kb')])

    expect(result).not.toHaveProperty('knowledge')
  })

  it('records the same knowledge summary on the mutation effect receipt evidence', async () => {
    const storage = inMemoryStorage()
    const source = model([
      { assertions: [{ type: 'fact', data: { value: 'ok' }, evidence: [chunkRef], provenance: 'derived' }] },
    ])
    const docs = knowledgeBase({
      id: 'kb-effects',
      storage,
      pipeline: indexingPipeline({ derive: [assertions({ id: 'facts', version: 1, types: assertionTypes, model: source })] }),
    })

    const run = await flow('derive-summary-effect-evidence', async (scope) =>
      scope.step('index', async () => {
        const result = await docs.index([chunk('doc-1', 'c1', 'Fact', 'kb-effects')])
        const receipt = effectLedger.receiptsFor(scope.effects.id)[0]
        const view = receipt
          ? await evidence.inspect(receiptRef(receipt), { includeData: true })
          : undefined
        return { result, records: view?.roles.verification.records ?? [] }
      }),
    ).run()

    expect(run.status).toBe('completed')
    if (run.status !== 'completed') return
    expect(run.output.records.map((record) => record.data)).toContainEqual({
      knowledge: run.output.result.knowledge,
    })
  })

  it('caps stage warnings at 50 entries plus a deterministic more marker', async () => {
    const storage = inMemoryStorage()
    const source = model([{ claims: [] }])
    const docs = knowledgeBase({
      id: 'kb-warning-cap',
      storage,
      pipeline: indexingPipeline({ derive: [relate({ id: 'refs', version: 1, types: relationTypes, model: source })] }),
    })
    const oversized = 'x'.repeat(MAX_DERIVE_BATCH_CHARS + 1)
    const chunks = Array.from({ length: 52 }, (_, index) =>
      ({ ...chunk('doc-1', `c${index + 1}`, oversized, 'kb-warning-cap'), ordinal: index }))

    const result = await docs.index(chunks)
    const warnings = result.knowledge?.stages[0]?.warnings ?? []

    expect(warnings).toHaveLength(51)
    expect(warnings[0]).toMatch(/Derive refs truncated chunk for source doc-1 chunk c1: 12001 -> \d+ chars\./)
    expect(warnings[1]).toMatch(/Derive refs truncated chunk for source doc-1 chunk c2: 12001 -> \d+ chars\./)
    expect(warnings[50]).toBe('+2 more')
  })
})

function model(objects: readonly unknown[]): KnowledgeModel {
  let index = 0
  return {
    name: 'derive-diagnostics',
    fingerprint: 'derive-diagnostics-v1',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async () => ({ object: objects[index++] ?? objects[objects.length - 1] })),
  }
}

function document(sourceId: string, content: string): CruxDocument {
  return { namespace, sourceId, content, metadata: {} }
}

function chunk(sourceId: string, chunkId: string, content: string, ns = namespace): CruxChunk {
  return { namespace: ns, sourceId, chunkId, ordinal: 0, content, metadata: {} }
}

function receiptRef(receipt: EffectReceipt) {
  return { kind: 'effect.receipt' as const, id: receipt.id, effectId: receipt.effectId }
}
