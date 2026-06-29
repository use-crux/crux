import { describe, expect, it } from 'vitest'
import { list as memoryList } from '../src/component/memory'
import { STORE_DOC_COMPONENT_SPEC, type StoreDocRecord } from '../store-doc'

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
    query(table: typeof STORE_DOC_COMPONENT_SPEC.table): TestQueryInitializer
  }
}

interface TestQueryInitializer {
  withIndex(
    indexName: typeof STORE_DOC_COMPONENT_SPEC.indexes.byKey,
    range?: (q: TestIndexRangeBuilder) => unknown,
  ): TestOrderedQuery
}

interface TestIndexRangeBuilder {
  gte(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): TestUpperBoundRangeBuilder
  gt(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): TestUpperBoundRangeBuilder
}

interface TestUpperBoundRangeBuilder {
  lt(field: typeof STORE_DOC_COMPONENT_SPEC.fields.key, value: string): unknown
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
      { type: 'gt', field: STORE_DOC_COMPONENT_SPEC.fields.key, value: 'memory:aardvark' },
      { type: 'lt', field: STORE_DOC_COMPONENT_SPEC.fields.key, value: 'memory;' },
      { type: 'order', direction: 'asc' },
      { type: 'take', limit: 3 },
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
              gt(field, value) {
                calls.push({ type: 'gt', field, value })
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

function cruxDoc(key: string): StoreDocRecord {
  return {
    key,
    content: JSON.stringify({ text: key }),
    metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
    createdAt: 1,
    updatedAt: 2,
  }
}
