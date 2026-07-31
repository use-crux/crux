import { describe, expect, it } from 'vitest'
import {
  compareAndSet as memoryCompareAndSet,
  insert as memoryInsert,
  list as memoryList,
} from '../src/component/memory'
import {
  STORE_DOC_COMPONENT_SPEC,
  storeDocVersion,
  type StoreDocRecord,
  type StoreDocWrite,
} from '../src/store-doc'

interface TestMemoryListArgs {
  prefix?: string
  limit?: number
  cursor?: string
}

interface TestMemoryListResult {
  docs: readonly StoreDocRecord[]
  cursor?: string
}

interface TestRegisteredQuery<TArgs, TResult> {
  _handler(ctx: TestQueryCtx, args: TArgs): Promise<TResult>
}

interface TestRegisteredMutation<TArgs, TResult> {
  _handler(ctx: TestMutationCtx, args: TArgs): Promise<TResult>
}

interface TestQueryCtx {
  db: {
    query(table: typeof STORE_DOC_COMPONENT_SPEC.table): TestQueryInitializer
  }
}

interface TestMutationCtx {
  db: {
    query(table: typeof STORE_DOC_COMPONENT_SPEC.table): TestFirstQueryInitializer
    insert(table: typeof STORE_DOC_COMPONENT_SPEC.table, doc: StoreDocRecord): Promise<string>
    patch(id: unknown, doc: StoreDocRecord): Promise<void>
    delete(id: unknown): Promise<void>
  }
}

interface TestQueryInitializer {
  withIndex(
    indexName: typeof STORE_DOC_COMPONENT_SPEC.indexes.byKey,
    range?: (q: TestIndexRangeBuilder) => unknown,
  ): TestOrderedQuery
}

interface TestFirstQueryInitializer {
  withIndex(
    indexName: typeof STORE_DOC_COMPONENT_SPEC.indexes.byKey,
    range?: (q: TestEqIndexRangeBuilder) => unknown,
  ): TestFirstQuery
}

interface TestIndexRangeBuilder {
  gte(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): TestUpperBoundRangeBuilder
  gt(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): TestUpperBoundRangeBuilder
}

interface TestEqIndexRangeBuilder {
  eq(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): unknown
}

interface TestUpperBoundRangeBuilder {
  lt(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): unknown
}

interface TestFirstQuery {
  first(): Promise<StoreDocRecord | null>
}

interface TestOrderedQuery {
  order(direction: 'asc' | 'desc'): TestTakenQuery
}

interface TestTakenQuery {
  take(limit: number): Promise<StoreDocRecord[]>
}

describe('component memory list contract', () => {
  it('returns a canonical page and uses component-safe key cursor pagination', async () => {
    const calls: Array<
      | { type: 'query'; table: string }
      | { type: 'withIndex'; indexName: string }
      | { type: 'gte'; field: string; value: string }
      | { type: 'gt'; field: string; value: string }
      | { type: 'lt'; field: string; value: string }
      | { type: 'order'; direction: string }
      | { type: 'take'; limit: number }
    > = []
    const docs = [cruxDoc('memory:alpha'), cruxDoc('memory:beta'), cruxDoc('memory:charlie')]
    const query = memoryList as unknown as TestRegisteredQuery<TestMemoryListArgs, TestMemoryListResult>
    const result = await query._handler(createCtx(calls, docs), {
      prefix: 'memory:',
      limit: 2,
      cursor: 'memory:aardvark',
    })

    expect(result).toEqual({ docs: docs.slice(0, 2), cursor: 'memory:beta' })
    expect(calls).toEqual([
      { type: 'query', table: STORE_DOC_COMPONENT_SPEC.table },
      { type: 'withIndex', indexName: STORE_DOC_COMPONENT_SPEC.indexes.byKey },
      {
        type: 'gt',
        field: STORE_DOC_COMPONENT_SPEC.fields.key,
        value: 'memory:aardvark',
      },
      {
        type: 'lt',
        field: STORE_DOC_COMPONENT_SPEC.fields.key,
        value: 'memory;',
      },
      { type: 'order', direction: 'asc' },
      { type: 'take', limit: 3 },
    ])
  })

  it('inserts a memory document only when the key is absent', async () => {
    const insertedDocs: StoreDocRecord[] = []
    const patchedDocs: StoreDocRecord[] = []
    const query = memoryInsert as unknown as TestRegisteredMutation<StoreDocRecord, boolean>

    await expect(
      query._handler(createInsertCtx(cruxDoc('memory:existing'), insertedDocs, patchedDocs), cruxDoc('memory:existing')),
    ).resolves.toBe(false)
    await expect(query._handler(createInsertCtx(null, insertedDocs, patchedDocs), cruxDoc('memory:new'))).resolves.toBe(true)
    await expect(
      query._handler(
        createInsertCtx(expiredCruxDoc('memory:expired'), insertedDocs, patchedDocs),
        cruxDoc('memory:expired'),
      ),
    ).resolves.toBe(true)

    expect(insertedDocs).toEqual([
      {
        ...cruxDoc('memory:new'),
        createdAt: 2,
        embedding: undefined,
      },
    ])
    expect(patchedDocs).toEqual([
      {
        content: JSON.stringify({ text: 'memory:expired' }),
        metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
        createdAt: 2,
        updatedAt: 2,
        embedding: undefined,
      },
    ])
  })

  it('compares and writes one memory document in the component mutation', async () => {
    const existing = { ...cruxDoc('memory:counter'), _id: 'doc-1' }
    const next = {
      ...cruxDoc('memory:counter'),
      content: JSON.stringify({ count: 1 }),
      updatedAt: 3,
    }
    const patchedDocs: StoreDocRecord[] = []
    const deletedIds: unknown[] = []
    const mutation = memoryCompareAndSet as unknown as TestRegisteredMutation<
      {
        key: string
        expectedVersion: string | null
        doc: StoreDocRecord | null
      },
      boolean
    >
    const ctx = createMutationCtx(existing, [], patchedDocs, deletedIds)

    await expect(
      mutation._handler(ctx, {
        key: 'memory:counter',
        expectedVersion: 'stale',
        doc: next,
      }),
    ).resolves.toBe(false)
    await expect(
      mutation._handler(ctx, {
        key: 'memory:counter',
        expectedVersion: storeDocVersion(existing),
        doc: next,
      }),
    ).resolves.toBe(true)

    expect(patchedDocs).toEqual([
      {
        content: next.content,
        metadata: next.metadata,
        embedding: undefined,
        updatedAt: 3,
      },
    ])
    expect(deletedIds).toEqual([])
  })
})

function createCtx(calls: Array<Record<string, unknown>>, docs: StoreDocRecord[]): TestQueryCtx {
  return {
    db: {
      query(table) {
        calls.push({ type: 'query', table })
        return {
          withIndex(indexName, range) {
            calls.push({ type: 'withIndex', indexName })
            range?.({
              gte(field, value) {
                calls.push({ type: 'gte', field, value })
                return {
                  lt(upperField, upperValue) {
                    calls.push({
                      type: 'lt',
                      field: upperField,
                      value: upperValue,
                    })
                    return {}
                  },
                }
              },
              gt(field, value) {
                calls.push({ type: 'gt', field, value })
                return {
                  lt(upperField, upperValue) {
                    calls.push({
                      type: 'lt',
                      field: upperField,
                      value: upperValue,
                    })
                    return {}
                  },
                }
              },
            })
            return {
              order(direction) {
                calls.push({ type: 'order', direction })
                return {
                  async take(limit) {
                    calls.push({ type: 'take', limit })
                    return docs.slice(0, limit)
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

function createInsertCtx(
  existing: StoreDocRecord | null,
  insertedDocs: StoreDocRecord[],
  patchedDocs: StoreDocRecord[],
): TestMutationCtx {
  return createMutationCtx(existing, insertedDocs, patchedDocs, [])
}

function createMutationCtx(
  existing: StoreDocRecord | null,
  insertedDocs: StoreDocRecord[],
  patchedDocs: StoreDocRecord[],
  deletedIds: unknown[],
): TestMutationCtx {
  return {
    db: {
      query() {
        return {
          withIndex(_indexName, range) {
            range?.({
              eq() {
                return {}
              },
            })
            return {
              async first() {
                return existing
              },
            }
          },
        }
      },
      async insert(_table, doc) {
        insertedDocs.push(doc)
        return 'doc-id'
      },
      async patch(_id, doc) {
        patchedDocs.push(doc)
      },
      async delete(id) {
        deletedIds.push(id)
      },
    },
  }
}

function cruxDoc(key: string): StoreDocWrite {
  return {
    key,
    content: JSON.stringify({ text: key }),
    metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
    createdAt: 1,
    updatedAt: 2,
  }
}

function expiredCruxDoc(key: string): StoreDocRecord {
  return {
    ...cruxDoc(key),
    content: JSON.stringify({
      text: key,
      [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1,
    }),
  }
}
