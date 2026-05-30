import { afterEach, describe, expect, it } from 'vitest'
import { config, prompt } from '@crux/core'
import { inMemoryCruxStore } from '@crux/core/store'
import { setup } from '../bridge'

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

const bridgePrompt = prompt({ id: 'convex-bridge-test', system: 'Bridge test' })

describe('@crux/convex bridge setup', () => {
  afterEach(() => {
    // Individual tests dispose their config instance. This keeps failures from
    // leaking runtime state into the next test.
  })

  it('registers HTTP manifest, command, and options routes', async () => {
    const crux = config({
      prompts: [bridgePrompt],
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
    const store = inMemoryCruxStore()
    await store.set('memory:1', { ok: true })
    const crux = config({
      prompts: [bridgePrompt],
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux, {
      store: () => store,
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

  it('returns a structured 400 for malformed command requests', async () => {
    const crux = config({
      prompts: [bridgePrompt],
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    const http = new FakeHttpRouter()

    setup(http, crux, {
      store: () => inMemoryCruxStore(),
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
      prompts: [bridgePrompt],
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
})
