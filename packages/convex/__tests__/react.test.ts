import { describe, expect, it } from 'vitest'
import { createConvexTransport } from '../react'
import type { JsonObject } from '@crux/core/store'

const api = {
  memory: {
    get: Symbol('memory.get'),
    list: Symbol('memory.list'),
  },
}

describe('createConvexTransport document boundary', () => {
  it('preserves loading, missing, and expired document states', () => {
    const loading = createTransportHarness()
    expect(loading.transport.useDocument(undefined)).toBeUndefined()

    const missing = createTransportHarness({ getResult: null })
    expect(missing.transport.useDocument('missing')).toBeNull()

    const expired = createTransportHarness({
      getResult: cruxDoc('memory:expired', { content: 'Old', _expiresAt: 1 }),
    })
    expect(expired.transport.useDocument('memory:expired')).toBeNull()
  })

  it('fails clearly for malformed transport documents', () => {
    const malformed = createTransportHarness({
      getResult: {
        key: 'memory:bad',
        content: JSON.stringify({ content: 'Bad' }),
        metadata: {},
      },
    })

    expect(() => malformed.transport.useDocument('memory:bad')).toThrow(/current Crux store format/i)
  })

  it('suppresses expired list documents and applies top-level filters', () => {
    const harness = createTransportHarness({
      listResult: {
        docs: [
          cruxDoc('memory:expired', { content: 'Old', namespace: 'kb', _expiresAt: 1 }),
          cruxDoc('memory:fresh', { content: 'Fresh', namespace: 'kb' }),
          cruxDoc('memory:other', { content: 'Other', namespace: 'other' }),
        ],
        cursor: 'cursor-1',
      },
    })

    expect(harness.transport.useDocumentList('memory:', { limit: 3, filter: { namespace: 'kb' } })).toEqual([
      {
        key: 'memory:fresh',
        value: { content: 'Fresh', namespace: 'kb' },
      },
    ])
    expect(harness.calls.at(-1)?.args).toEqual({ prefix: 'memory:', limit: 3 })
  })
})

function createTransportHarness(options: { getResult?: unknown; listResult?: unknown } = {}) {
  const calls: Array<{ query: unknown; args: unknown }> = []
  const useQuery = (query: unknown, args: unknown): unknown => {
    calls.push({ query, args })
    if (args === 'skip') return undefined
    if (query === api.memory.get) return options.getResult
    if (query === api.memory.list) return options.listResult ?? { docs: [] }
    return undefined
  }
  return {
    transport: createConvexTransport({ api, useQuery }),
    calls,
  }
}

function cruxDoc(key: string, value: JsonObject): Record<string, unknown> {
  return {
    key,
    content: JSON.stringify(value),
    metadata: { _cruxDoc: true },
    createdAt: 1,
    updatedAt: 2,
  }
}
