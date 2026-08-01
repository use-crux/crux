import { describe, expect, it } from 'vitest'
import { createKnowledgeGenerationStore, type KnowledgeGenerationRetention } from '../../src/knowledge/generation'
import { knowledgeCurrentKey, knowledgeEntityKey, knowledgeGenerationPrefix } from '../../src/knowledge/keys'
import { asKnowledgeEntityRecord, createKnowledgeEntityRecord } from '../../src/knowledge/records'
import { inMemoryStorage } from '../../src/storage'

const indexerId = 'docs'
const namespace = 'kb'

describe('connected knowledge generation store', () => {
  it('publish swaps the pointer and readers see the new generation id', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })

    const first = generations.beginGeneration('gen-1')
    await first.putEntity(entity('gen-1', 'crux'))
    await first.finish()
    await generations.publish('gen-1')

    await expect(generations.currentGeneration()).resolves.toBe('gen-1')
    await expect(records.get(knowledgeCurrentKey(indexerId, namespace))).resolves.toMatchObject({
      generationId: 'gen-1',
    })

    const second = generations.beginGeneration('gen-2')
    await second.putEntity(entity('gen-2', 'crux'))
    await second.finish()
    await generations.publish('gen-2')

    await expect(generations.currentGeneration()).resolves.toBe('gen-2')
  })

  it('keeps the prior published generation active when a later build never publishes', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })
    const stableKey = knowledgeEntityKey(indexerId, namespace, 'gen-1', 'stable')
    const partialKey = knowledgeEntityKey(indexerId, namespace, 'gen-2', 'partial')

    const stable = generations.beginGeneration('gen-1')
    await stable.putEntity(entity('gen-1', 'stable'))
    await stable.finish()
    await generations.publish('gen-1')

    const partial = generations.beginGeneration('gen-2')
    await partial.putEntity(entity('gen-2', 'partial'))

    await expect(generations.currentGeneration()).resolves.toBe('gen-1')
    expect(asKnowledgeEntityRecord(await records.get(stableKey))?.entityId).toBe('stable')
    expect(asKnowledgeEntityRecord(await records.get(partialKey))?.entityId).toBe('partial')
  })

  it('allows an idempotent generation-scoped rewrite without duplicate records', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })
    const writer = generations.beginGeneration('gen-1')
    const record = entity('gen-1', 'same')

    await writer.putEntity(record)
    await writer.putEntity(record)
    await writer.finish()
    await generations.publish('gen-1')

    const page = await records.list(knowledgeGenerationPrefix(indexerId, namespace, 'gen-1'))
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]?.key).toBe(knowledgeEntityKey(indexerId, namespace, 'gen-1', 'same'))
  })

  it('cleans up the replaced generation by default after the pointer swap', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })
    const firstKey = knowledgeEntityKey(indexerId, namespace, 'gen-1', 'old')

    await publishEntity(generations, 'gen-1', 'old')
    const pinnedGeneration = await generations.currentGeneration()
    expect(pinnedGeneration).toBe('gen-1')
    expect(asKnowledgeEntityRecord(await records.get(firstKey))?.entityId).toBe('old')

    await publishEntity(generations, 'gen-2', 'new')

    await expect(generations.currentGeneration()).resolves.toBe('gen-2')
    await expect(records.get(firstKey)).resolves.toBeNull()
    await expect(records.list(knowledgeGenerationPrefix(indexerId, namespace, 'gen-1'))).resolves.toMatchObject({
      entries: [],
    })
  })

  it('retains replaced generation records when retention is retain-inactive', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({
      records,
      indexerId,
      namespace,
      retention: 'retain-inactive',
    })
    const firstKey = knowledgeEntityKey(indexerId, namespace, 'gen-1', 'old')

    await publishEntity(generations, 'gen-1', 'old')
    await publishEntity(generations, 'gen-2', 'new')

    await expect(generations.currentGeneration()).resolves.toBe('gen-2')
    expect(asKnowledgeEntityRecord(await records.get(firstKey))?.entityId).toBe('old')
  })

  it('publish of an unknown or abandoned generation fails with a clear error', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })
    const abandonedKey = knowledgeEntityKey(indexerId, namespace, 'draft', 'partial')

    await expect(generations.publish('missing')).rejects.toThrow('Unknown knowledge generation "missing"')

    const draft = generations.beginGeneration('draft')
    await draft.putEntity(entity('draft', 'partial'))
    await generations.abandon('draft')

    await expect(records.get(abandonedKey)).resolves.toBeNull()
    await expect(generations.publish('draft')).rejects.toThrow('Knowledge generation "draft" was abandoned')
  })
})

function entity(generationId: string, entityId: string) {
  return createKnowledgeEntityRecord({
    entityId,
    canonicalName: entityId,
    aliases: [],
    generationId,
    namespace,
  })
}

async function publishEntity(
  generations: ReturnType<typeof createKnowledgeGenerationStore>,
  generationId: string,
  entityId: string,
  retention?: KnowledgeGenerationRetention,
): Promise<void> {
  const writer = generations.beginGeneration(generationId)
  await writer.putEntity(entity(generationId, entityId))
  await writer.finish()
  await generations.publish(generationId, retention ? { retention } : undefined)
}
