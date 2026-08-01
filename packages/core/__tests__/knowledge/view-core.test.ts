import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeViewWhere, ViewWhereValidationError } from '../../src/knowledge/view/where'
import { applyMembershipForSource, resolveViewMembers } from '../../src/knowledge/view/membership'
import { loadViewRevision, resolveViewRevision } from '../../src/knowledge/view/revision'
import { inMemoryStorage, type JsonObject, type RecordPage, type RecordStore } from '../../src/storage'

const indexerId = 'docs'
const namespace = 'kb'
const viewId = 'active-docs'
const schema = z.object({
  status: z.enum(['open', 'closed']),
  team: z.string(),
  priority: z.number(),
  published: z.boolean().optional(),
  tags: z.array(z.string()),
})

describe('connected knowledge view core', () => {
  it('normalizes view where predicates deterministically', () => {
    const left = normalizeViewWhere(
      { any: [{ team: ['docs', 'core', 'docs'], status: 'open' }, { priority: [2, 1, 1] }] },
      schema,
    )
    const right = normalizeViewWhere(
      { any: [{ priority: [1, 2] }, { status: 'open', team: ['core', 'docs'] }] },
      schema,
    )

    expect(left).toEqual(right)
    expect(left).toEqual({
      any: [
        [{ field: 'priority', values: [1, 2] }],
        [
          { field: 'status', values: ['open'] },
          { field: 'team', values: ['core', 'docs'] },
        ],
      ],
    })
  })

  it('rejects runtime predicates that mirror type errors', () => {
    expect(() => normalizeViewWhere({ missing: 'x' } as never, schema)).toThrow(ViewWhereValidationError)
    expect(() => normalizeViewWhere({ status: { nested: true } } as never, schema)).toThrow(/scalar values/)
    expect(() => normalizeViewWhere({ tags: 'docs' } as never, schema)).toThrow(/not scalar metadata/)
    expect(() => normalizeViewWhere({ any: [] } as never, schema)).toThrow(/at least one clause/)
  })

  it('updates membership indexes incrementally for one source', async () => {
    const { records } = inMemoryStorage()
    const counted = countRecordAccess(records)
    const where = normalizeViewWhere({ any: [{ status: ['open', 'closed'] }, { team: 'docs' }] }, schema)

    await applyMembershipForSource({
      records: counted.store,
      indexerId,
      namespace,
      viewId,
      where,
      sourceId: 's1',
      metadata: { status: 'open', team: 'docs' },
    })

    expect(counted.listPrefixes).toEqual([])
    expect(counted.writeKeys.every((key) => key.endsWith(':s1'))).toBe(true)
    expect(counted.deleteKeys).toHaveLength(3)
    expect(counted.putKeys).toHaveLength(2)
  })

  it('resolves members by reading only view index entries', async () => {
    const { records } = inMemoryStorage()
    const where = normalizeViewWhere(
      { any: [{ status: 'open', team: ['docs', 'core'] }, { priority: 2 }] },
      schema,
    )
    await records.put('indexer:docs:namespace:kb:source:s1:chunk:c1', { sourceId: 's1' })
    await indexSource(records, where, 's1', { status: 'open', team: 'docs', priority: 1 })
    await indexSource(records, where, 's2', { status: 'open', team: 'web', priority: 2 })
    await indexSource(records, where, 's3', { status: 'closed', team: 'core', priority: 2 })
    await indexSource(records, where, 's4', { status: 'open', team: 'core', priority: 1 })
    const counted = countRecordAccess(records)

    await expect(resolveViewMembers({ records: counted.store, indexerId, namespace, viewId, where })).resolves.toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
    expect(counted.getKeys).toEqual([])
    expect(counted.listPrefixes.every((prefix) => prefix.includes(':view:active-docs:index:'))).toBe(true)
  })

  it('persists content-addressed revisions idempotently', async () => {
    const { records } = inMemoryStorage()
    const counted = countRecordAccess(records)
    const first = await resolveViewRevision({
      records: counted.store,
      indexerId,
      namespace,
      viewId,
      members: [
        { sourceId: 's2', contentHash: 'h2' },
        { sourceId: 's1', contentHash: 'h1' },
      ],
    })
    const second = await resolveViewRevision({
      records: counted.store,
      indexerId,
      namespace,
      viewId,
      members: [
        { sourceId: 's1', contentHash: 'h1' },
        { sourceId: 's2', contentHash: 'h2' },
      ],
    })
    const changed = await resolveViewRevision({
      records: counted.store,
      indexerId,
      namespace,
      viewId,
      members: [
        { sourceId: 's1', contentHash: 'h1' },
        { sourceId: 's3', contentHash: 'h3' },
      ],
    })

    expect(second.revisionHash).toBe(first.revisionHash)
    expect(changed.revisionHash).not.toBe(first.revisionHash)
    expect(counted.createKeys.filter((key) => key.includes(`revision:${first.revisionHash}`))).toHaveLength(2)
    await expect(loadViewRevision({ records, indexerId, namespace, viewId, revisionHash: first.revisionHash })).resolves.toEqual(first)
    await expect(loadViewRevision({ records, indexerId, namespace, viewId, revisionHash: 'missing' })).resolves.toBeNull()
  })
})

async function indexSource(
  records: RecordStore,
  where: ReturnType<typeof normalizeViewWhere<typeof schema>>,
  sourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await applyMembershipForSource({ records, indexerId, namespace, viewId, where, sourceId, metadata })
}

function countRecordAccess(records: RecordStore): {
  readonly store: RecordStore
  readonly getKeys: string[]
  readonly listPrefixes: string[]
  readonly putKeys: string[]
  readonly deleteKeys: string[]
  readonly createKeys: string[]
  readonly writeKeys: string[]
} {
  const getKeys: string[] = []
  const listPrefixes: string[] = []
  const putKeys: string[] = []
  const deleteKeys: string[] = []
  const createKeys: string[] = []
  const store: RecordStore = {
    ...records,
    get: async (key) => {
      getKeys.push(key)
      return records.get(key)
    },
    put: async (key, value, options) => {
      putKeys.push(key)
      return records.put(key, value, options)
    },
    create: async (key, value, options) => {
      createKeys.push(key)
      return records.create ? records.create(key, value, options) : false
    },
    delete: async (key) => {
      deleteKeys.push(key)
      return records.delete(key)
    },
    list: async (prefix, options): Promise<RecordPage<JsonObject>> => {
      listPrefixes.push(prefix)
      return records.list(prefix, options)
    },
  }
  return {
    store,
    getKeys,
    listPrefixes,
    putKeys,
    deleteKeys,
    createKeys,
    get writeKeys() {
      return [...putKeys, ...deleteKeys, ...createKeys]
    },
  }
}
