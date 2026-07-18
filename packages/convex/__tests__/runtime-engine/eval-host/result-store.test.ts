import { describe, expect, it } from 'vitest'
import { RUNTIME_RESULT_MAX_BYTES } from '@use-crux/core/runtime'
import type { ConvexCtxPort } from '../../../src/store'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../../../src/runtime'

const resultRefs = {
  put: { operation: 'results.put' },
  get: { operation: 'results.get' },
  deleteResult: { operation: 'results.delete' },
  pruneUnreferenced: { operation: 'results.prune' },
}

const component = {
  runtime: {
    state: {},
    events: {},
    waiters: {},
    timers: {},
    outbox: {},
    leases: {},
    results: resultRefs,
  },
} satisfies ConvexRuntimeComponent

describe('Convex Runtime result store', () => {
  it('chunks canonical near-ceiling payloads and verifies them when read', async () => {
    let stored: Record<string, unknown> | undefined
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) => {
        if (ref === resultRefs.put) {
          stored = args
          return null as TResult
        }
        if (ref === resultRefs.get) return stored as TResult
        return null as TResult
      },
    }
    const store = convexRuntimeStore({ ctx, component })
    const payload = {
      output: 'x'.repeat(RUNTIME_RESULT_MAX_BYTES - '{"output":""}'.length),
    }

    const ref = await store.results!.put(payload, {
      namespace: 'eval-host:production',
    })

    expect(stored?.chunks).toEqual(expect.arrayContaining([expect.any(String)]))
    expect((stored?.chunks as string[]).length).toBeGreaterThan(1)
    await expect(store.results!.get(ref)).resolves.toEqual(payload)
  })
})
