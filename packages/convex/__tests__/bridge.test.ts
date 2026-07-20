import { afterEach, describe, expect, it } from 'vitest'
import { config } from '@use-crux/core'
import type { RecordStore } from '@use-crux/core/storage'
import { inMemoryRecordStore } from '@use-crux/core/storage'
import { createCruxConvex } from '../src'
import { setup } from '../src/bridge'

interface CapturedRoute {
  path?: string
  pathPrefix?: string
  method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE'
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

describe('@use-crux/convex bridge setup', () => {
  afterEach(() => {
    // Individual tests dispose their config instance. This keeps failures from
    // leaking runtime state into the next test.
  })

  it('registers HTTP manifest, command, and options routes', async () => {
    const crux = config({
      devtools: {
        serverUrl: 'https://project.convex.site',
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux)

    expect(http.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /crux/bridge',
      'POST /crux/bridge',
      'OPTIONS /crux/bridge',
    ])

    const getRoute = http.routes.find((route) => route.method === 'GET')
    const response = await (getRoute?.handler as TestHttpAction)._handler(
      {},
      new Request('https://project.convex.site/crux/bridge'),
    )
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      transport: 'http',
      url: 'https://project.convex.site/crux/bridge',
      environment: 'convex',
    })

    crux.dispose()
  })

  it('executes store.read with a ctx-aware store factory', async () => {
    const store = inMemoryRecordStore()
    await store.put('memory:1', { ok: true })
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux, {
      storage: () => ({ records: store }),
    })

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      {},
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_store',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'crux.store',
            key: 'memory:1',
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      type: 'command.result',
      commandId: 'cmd_store',
      result: {
        value: { ok: true },
      },
    })

    crux.dispose()
  })

  it('returns normalized details for command execution errors', async () => {
    const store = {
      async get() {
        throw new Error('convex store exploded')
      },
      async list() {
        return { entries: [] }
      },
    } as unknown as RecordStore
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux, {
      storage: () => ({ records: store }),
    })

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      {},
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_fail',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'crux.store',
            key: 'memory:1',
          },
        }),
      }),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({
      type: 'command.error',
      commandId: 'cmd_fail',
      error: {
        code: 'runtime_error',
        message: 'convex store exploded',
        details: {
          thrown: 'error',
          phase: 'runtime_bridge.command',
          errorKind: 'runtime_error',
          summary: {
            name: 'Error',
            message: 'convex store exploded',
            category: 'runtime_error',
          },
        },
      },
    })
    expect(body.error.details.stack).toContain('convex store exploded')

    crux.dispose()
  })

  it('returns a structured 400 for malformed command requests', async () => {
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux, {
      storage: () => ({ records: inMemoryRecordStore() }),
    })

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      {},
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: 'type:command.request',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      type: 'command.error',
      commandId: 'invalid_request',
      error: {
        code: 'invalid_json',
      },
    })

    crux.dispose()
  })

  it('executes store.read with a component-backed default store', async () => {
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()
    const memory = new Map<string, Record<string, unknown>>()
    memory.set('blackboard:thread', {
      key: 'blackboard:thread',
      content: JSON.stringify({ status: 'ready' }),
      metadata: { _cruxDoc: true },
    })
    const component = {
      memory: {
        get: 'memory.get',
        list: 'memory.list',
        set: 'memory.set',
        insert: 'memory.insert',
        remove: 'memory.remove',
      },
    }
    const ctx = {
      async runQuery(_fn: unknown, args: Record<string, unknown>) {
        if ('key' in args) return memory.get(String(args.key)) ?? null
        const prefix = String(args.prefix ?? '')
        return [...memory.values()].filter((doc) => String(doc.key).startsWith(prefix))
      },
      async runMutation() {
        return undefined
      },
    }

    setup(http, crux, {
      component: component as never,
    })

    const getRoute = http.routes.find((route) => route.method === 'GET')
    const manifestResponse = await (getRoute?.handler as TestHttpAction)._handler(
      ctx,
      new Request('https://project.convex.site/crux/bridge'),
    )
    await expect(manifestResponse.json()).resolves.toMatchObject({
      capabilities: [
        {
          command: 'store.read',
          resources: [
            {
              resource: 'crux.store',
              operations: ['get', 'list'],
            },
          ],
        },
      ],
    })

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      ctx,
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_component',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'blackboard:thread',
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      type: 'command.result',
      commandId: 'cmd_component',
      result: {
        value: { status: 'ready' },
      },
    })

    crux.dispose()
  })

  it('profile bridge resolves store.read through the profile store factory', async () => {
    const store = inMemoryRecordStore()
    await store.put('blackboard:profile', { status: 'profile-ready' })
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()
    const components = {
      crux: { marker: 'crux' } as never,
      agent: { marker: 'agent' } as never,
    }
    let createCount = 0
    const profile = createCruxConvex({
      components,
      storage: {
        create(_ctx, defaults) {
          createCount += 1
          expect(defaults.component).toBe(components.crux)
          return store
        },
      },
    })
    const ctx = {
      async runQuery() {
        return undefined
      },
      async runMutation() {
        return undefined
      },
    }

    profile.bridge(http, crux)

    const postRoute = http.routes.find((route) => route.method === 'POST')
    const response = await (postRoute?.handler as TestHttpAction)._handler(
      ctx,
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_profile',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'blackboard:profile',
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      type: 'command.result',
      commandId: 'cmd_profile',
      result: {
        value: { status: 'profile-ready' },
      },
    })
    expect(createCount).toBe(1)

    crux.dispose()
  })
})
