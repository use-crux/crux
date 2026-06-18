import { describe, expect, it } from 'vitest'
import { list as memoryList } from '../src/component/memory'
import type { StoreDocRecord } from '../store-doc'

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

interface TestQueryCtx {
  db: {
    query(table: 'memories'): TestQueryInitializer
  }
}

interface TestQueryInitializer {
  withIndex(indexName: 'by_key', range?: (q: TestIndexRangeBuilder) => unknown): TestOrderedQuery
}

interface TestIndexRangeBuilder {
  gte(field: 'key', value: string): TestUpperBoundRangeBuilder
}

interface TestUpperBoundRangeBuilder {
  lt(field: 'key', value: string): unknown
}

interface TestOrderedQuery {
  order(direction: 'asc' | 'desc'): TestPaginatedQuery
}

interface TestPaginatedQuery {
  paginate(options: { numItems: number; cursor: string | null }): Promise<{
    page: StoreDocRecord[]
    isDone: boolean
    continueCursor: string
  }>
}

describe('component memory list contract', () => {
  it('returns a canonical page and uses prefix-bounded by_key pagination', async () => {
    const calls: Array<
      | { type: 'query'; table: string }
      | { type: 'withIndex'; indexName: string }
      | { type: 'gte'; field: string; value: string }
      | { type: 'lt'; field: string; value: string }
      | { type: 'order'; direction: string }
      | { type: 'paginate'; options: { numItems: number; cursor: string | null } }
    > = []
    const docs = [cruxDoc('memory:alpha')]
    const query = memoryList as unknown as TestRegisteredQuery<TestMemoryListArgs, TestMemoryListResult>
    const result = await query._handler(createCtx(calls, docs), {
      prefix: 'memory:',
      limit: 2,
      cursor: 'cursor-1',
    })

    expect(result).toEqual({ docs, cursor: 'cursor-2' })
    expect(calls).toEqual([
      { type: 'query', table: 'memories' },
      { type: 'withIndex', indexName: 'by_key' },
      { type: 'gte', field: 'key', value: 'memory:' },
      { type: 'lt', field: 'key', value: 'memory;' },
      { type: 'order', direction: 'asc' },
      { type: 'paginate', options: { numItems: 2, cursor: 'cursor-1' } },
    ])
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
                    calls.push({ type: 'lt', field: upperField, value: upperValue })
                    return {}
                  },
                }
              },
            })
            return {
              order(direction) {
                calls.push({ type: 'order', direction })
                return {
                  async paginate(options) {
                    calls.push({ type: 'paginate', options })
                    return {
                      page: docs,
                      isDone: false,
                      continueCursor: 'cursor-2',
                    }
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

function cruxDoc(key: string): StoreDocRecord {
  return {
    key,
    content: JSON.stringify({ text: key }),
    metadata: { _cruxDoc: true },
    createdAt: 1,
    updatedAt: 2,
  }
}
