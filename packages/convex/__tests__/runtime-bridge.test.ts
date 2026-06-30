import { config } from '@use-crux/core'
import { describe, expect, it, vi } from 'vitest'
import { convexRuntimeRecords, createConvexRuntimeBridge, getConvexCruxRuntime, type ConvexCtxPort } from '../index'
import { inMemoryRecordStore, memory, memoryBlock } from '../memory'

interface TenantCtx extends ConvexCtxPort {
  tenantId: string
}

interface CapturedRoute {
  path: string
  method: 'GET' | 'POST' | 'OPTIONS'
  handler: unknown
}

class FakeHttpRouter {
  readonly routes: CapturedRoute[] = []

  route(route: CapturedRoute) {
    this.routes.push(route)
  }
}

type TestHttpAction = {
  _handler: (ctx: unknown, request: Request) => Promise<Response>
}

describe('Convex runtime bridge', () => {
  it('binds one ctx-scoped storage bundle and namespace for a run', async () => {
    const records = inMemoryRecordStore()
    const component = { marker: 'crux' } as never
    const createStore = vi.fn((ctx: TenantCtx, defaults) => {
      expect(ctx.tenantId).toBe('tenant-1')
      expect(defaults.component).toBe(component)
      return records
    })
    const ctx: TenantCtx = {
      tenantId: 'tenant-1',
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    }
    const runtimeMemory = memory({
      id: 'runtime-bridge-memory',
      blocks: [
        memoryBlock({
          id: 'namespace',
          render: ({ namespace }) => `namespace=${namespace}`,
        }),
      ],
    })

    const bridge = createConvexRuntimeBridge<TenantCtx>({
      component,
      namespace: ({ target }) => `runtime:${target?.threadId ?? 'missing'}`,
      storage: {
        create: createStore,
      },
    })

    const result = await bridge.run(ctx, { threadId: 'thread-1', attempt: 2 }, async (scope) => {
      expect(scope.ctx.tenantId).toBe('tenant-1')
      expect(scope.target?.attempt).toBe(2)
      expect(scope.runtime.records).toBe(records)
      await convexRuntimeRecords.put('runtime:key', { ok: true })
      const rendered = await runtimeMemory.asContext().systemFn({})
      return {
        stored: await records.get('runtime:key'),
        rendered,
        activeTarget: getConvexCruxRuntime()?.target,
      }
    })

    expect(result).toEqual({
      stored: { ok: true },
      rendered: expect.stringContaining('namespace=runtime:thread-1'),
      activeTarget: { threadId: 'thread-1', attempt: 2 },
    })
    expect(createStore).toHaveBeenCalledTimes(1)
  })

  it('executes bridge commands through the runtime bridge store path', async () => {
    const records = inMemoryRecordStore()
    await records.put('blackboard:runtime', { status: 'ready' })
    const createStore = vi.fn(() => records)
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()
    const bridge = createConvexRuntimeBridge<TenantCtx>({
      component: { marker: 'crux' } as never,
      storage: {
        create: createStore,
      },
    })

    bridge.bridge(http, crux)

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      {
        tenantId: 'tenant-1',
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } satisfies TenantCtx,
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_runtime_bridge',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'blackboard:runtime',
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      type: 'command.result',
      commandId: 'cmd_runtime_bridge',
      result: {
        value: { status: 'ready' },
      },
    })
    expect(createStore).toHaveBeenCalledTimes(1)

    crux.dispose()
  })
})
