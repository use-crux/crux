import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { config } from '../config'
import { prompt as cruxPrompt } from '../define'
import { blackboard } from '../agent/blackboard'
import {
  BridgeCommandRequestSchema,
  connectRuntimeBridge,
  deriveBridgeUrl,
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
  RuntimeBridgeConfigSchema,
  RuntimeBridgeMessageSchema,
  RuntimePeerHelloSchema,
} from '../runtime-bridge'
import { clearInspectableResources } from '../runtime-bridge/resources'
import { memory, recentMessages } from '../memory'
import { inMemoryCruxStore } from '../store'

const prompt = cruxPrompt({ id: 'bridge-test', system: 'Bridge test' })

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly sent: string[] = []
  readonly url: string
  readyState = 1
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.onopen?.({})
  }

  message(data: unknown) {
    this.onmessage?.({ data })
  }
}

describe('devtools runtime bridge contract', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.unstubAllGlobals()
    clearInspectableResources()
  })

  it('accepts bridge options on config()', () => {
    const crux = config({
      prompts: [prompt],
      devtools: {
        serverUrl: 'http://localhost:4400',
        bridge: {
          transport: 'http',
          url: 'https://example.convex.site/crux/bridge',
          runtimeName: 'convex-dev',
        },
      },
    })

    expect(crux.config.devtools?.bridge).toMatchObject({
      transport: 'http',
      url: 'https://example.convex.site/crux/bridge',
    })

    crux.dispose()
  })

  it('parses boolean and explicit bridge configuration', () => {
    expect(RuntimeBridgeConfigSchema.parse(true)).toBe(true)
    expect(
      RuntimeBridgeConfigSchema.parse({
        transport: 'ws',
        connectUrl: 'ws://localhost:4400/ws/runtime',
        reconnect: { minMs: 250, maxMs: 5_000 },
      }),
    ).toMatchObject({
      transport: 'ws',
      connectUrl: 'ws://localhost:4400/ws/runtime',
    })
  })

  it('parses runtime hello capabilities', () => {
    const parsed = RuntimePeerHelloSchema.parse({
      type: 'runtime.hello',
      peer: {
        runtimeName: 'local-node',
        transport: 'ws',
        capabilities: [
          {
            command: 'eval.run',
            targets: [{ definitionId: 'eval:writer', kind: 'eval', name: 'Writer eval' }],
          },
          {
            command: 'store.read',
            resources: [{ resource: 'crux.store', operations: ['get', 'list'] }],
          },
        ],
      },
    })

    expect(parsed.peer.environment).toBe('unknown')
    expect(parsed.peer.capabilities).toHaveLength(2)
  })

  it('parses eval.run and store.read command requests', () => {
    expect(
      BridgeCommandRequestSchema.parse({
        type: 'command.request',
        commandId: 'cmd_eval',
        command: 'eval.run',
        targetId: 'eval:writer',
        payload: {},
      }),
    ).toMatchObject({
      command: 'eval.run',
      payload: { persist: true },
    })

    expect(
      BridgeCommandRequestSchema.parse({
        type: 'command.request',
        commandId: 'cmd_store',
        command: 'store.read',
        payload: {
          operation: 'list',
          resource: 'crux.store',
          prefix: 'memory:',
          limit: 50,
        },
      }),
    ).toMatchObject({
      command: 'store.read',
      payload: { operation: 'list', resource: 'crux.store' },
    })
  })

  it('rejects unknown bridge commands', () => {
    expect(() =>
      RuntimeBridgeMessageSchema.parse({
        type: 'command.request',
        commandId: 'cmd_unknown',
        command: 'agent.run',
        targetId: 'agent:chat',
        payload: {},
      }),
    ).toThrow()
  })

  it('derives the default local Node websocket bridge manifest', () => {
    const manifest = getRuntimeBridgeManifest({
      devtools: {
        serverUrl: 'http://localhost:4400',
        bridge: true,
      },
      store: {},
      eval: { include: './evals/**/*.eval.ts' },
    })

    expect(manifest).toMatchObject({
      enabled: true,
      transport: 'ws',
      url: 'ws://localhost:4400/ws/runtime',
      endpointPath: '/ws/runtime',
      environment: 'node',
      capabilities: [{ command: 'store.read', resources: [{ resource: 'crux.store', operations: ['get', 'list'] }] }],
    })
  })

  it('derives framework HTTP bridge manifests from explicit integration options', () => {
    const manifest = getRuntimeBridgeManifest(
      {
        devtools: {
          serverUrl: 'https://project.convex.site',
          bridge: true,
        },
        store: {},
      },
      {
        environment: 'convex',
        transport: 'http',
        endpointPath: '/crux/bridge',
      },
    )

    expect(manifest).toMatchObject({
      transport: 'http',
      url: 'https://project.convex.site/crux/bridge',
      environment: 'convex',
      endpointPath: '/crux/bridge',
    })
  })

  it('lets explicit bridge transport and url override defaults', () => {
    const manifest = getRuntimeBridgeManifest(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: {
            transport: 'http',
            url: 'https://override.example/crux/bridge',
          },
        },
      },
      { transport: 'ws', environment: 'node' },
    )

    expect(manifest).toMatchObject({
      transport: 'http',
      url: 'https://override.example/crux/bridge',
    })
  })

  it('normalizes bridge URLs for http and ws transports', () => {
    expect(deriveBridgeUrl('http://localhost:4400', 'ws', '/ws/runtime')).toBe('ws://localhost:4400/ws/runtime')
    expect(deriveBridgeUrl('wss://example.dev', 'http', '/crux/bridge')).toBe('https://example.dev/crux/bridge')
  })

  it('connects a local Node websocket peer and sends runtime hello', () => {
    const connection = connectRuntimeBridge(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: true,
        },
        store: {},
      },
      {
        WebSocket: FakeWebSocket,
      },
    )

    expect(connection).toBeDefined()
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('ws://localhost:4400/ws/runtime')

    socket.open()

    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      type: 'runtime.hello',
      peer: {
        peerId: connection?.peerId,
        runtimeName: 'crux-runtime',
        environment: 'node',
        transport: 'ws',
      },
    })

    connection?.dispose()
    expect(socket.readyState).toBe(3)
  })

  it('executes store.read commands over the websocket peer', async () => {
    const store = {
      async get(key: string) {
        return { key, ok: true }
      },
      async list(prefix: string) {
        return { entries: [{ key: `${prefix}1`, value: { ok: true } }] }
      },
    }
    connectRuntimeBridge(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: true,
        },
        store,
      },
      { WebSocket: FakeWebSocket },
    )
    const socket = FakeWebSocket.instances[0]
    socket.open()

    socket.message(
      JSON.stringify({
        type: 'command.request',
        commandId: 'cmd_store',
        command: 'store.read',
        payload: {
          operation: 'get',
          resource: 'crux.store',
          key: 'memory:1',
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toMatchObject({
      type: 'command.result',
      commandId: 'cmd_store',
      result: {
        value: { key: 'memory:1', ok: true },
      },
    })
  })

  it('includes normalized error details when websocket command execution fails', async () => {
    const store = {
      async get() {
        throw new Error('store exploded')
      },
      async list() {
        return { entries: [] }
      },
    }
    connectRuntimeBridge(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: true,
        },
        store,
      },
      { WebSocket: FakeWebSocket },
    )
    const socket = FakeWebSocket.instances[0]
    socket.open()

    socket.message(
      JSON.stringify({
        type: 'command.request',
        commandId: 'cmd_fail',
        command: 'store.read',
        payload: {
          operation: 'get',
          resource: 'crux.store',
          key: 'memory:1',
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    const reply = JSON.parse(socket.sent.at(-1) ?? '{}')
    expect(reply).toMatchObject({
      type: 'command.error',
      commandId: 'cmd_fail',
      error: {
        code: 'runtime_error',
        message: 'store exploded',
        details: {
          thrown: 'error',
          phase: 'runtime_bridge.command',
          errorKind: 'runtime_error',
          summary: {
            name: 'Error',
            message: 'store exploded',
            category: 'runtime_error',
          },
        },
      },
    })
    expect(reply.error.details.stack).toContain('store exploded')
  })

  it('starts and disposes the local Node websocket peer from config()', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const crux = config({
      prompts: [prompt],
      store: {
        async get() {
          return null
        },
        async list() {
          return { entries: [] }
        },
      },
      devtools: {
        bridge: {
          connectUrl: 'ws://localhost:4400/ws/runtime',
        },
      },
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('ws://localhost:4400/ws/runtime')

    socket.open()
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      type: 'runtime.hello',
      peer: {
        transport: 'ws',
        capabilities: [{ command: 'store.read' }],
      },
    })

    crux.dispose()
    expect(socket.readyState).toBe(3)
  })

  it('advertises resources automatically registered by primitives', () => {
    const store = inMemoryCruxStore()
    memory({
      id: 'project-memory',
      namespace: 'project-1',
      store,
      blocks: [recentMessages({ id: 'recent' })],
    })
    blackboard({ id: 'thread', schema: z.object({ status: z.string().optional() }), store })

    const manifest = getRuntimeBridgeManifest({
      devtools: { serverUrl: 'http://localhost:4400', bridge: true },
    })

    expect(manifest?.capabilities).toContainEqual({
      command: 'store.read',
      resources: expect.arrayContaining([
        expect.objectContaining({ resource: 'blackboard:thread', kind: 'blackboard' }),
        expect.objectContaining({ resource: 'memory:project-memory', kind: 'memory' }),
      ]),
    })
  })

  it('reads an automatically registered blackboard resource without a manual key', async () => {
    const store = inMemoryCruxStore()
    const board = blackboard({ id: 'thread', schema: z.object({ status: z.string() }), store })
    await board.set('status', 'ready')

    await expect(
      executeRuntimeBridgeCommand(
        {},
        {
          type: 'command.request',
          commandId: 'cmd_blackboard',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'blackboard:thread',
          },
        },
      ),
    ).resolves.toMatchObject({
      value: {
        content: JSON.stringify({ status: 'ready' }),
      },
    })
  })

  it('infers memory resources from trace ids when a readable runtime store is available', async () => {
    const store = inMemoryCruxStore()
    await store.set('memory:dynamic:thread-1:block:recent:000001', { role: 'user', content: 'hello' })

    await expect(
      executeRuntimeBridgeCommand(
        { store },
        {
          type: 'command.request',
          commandId: 'cmd_memory',
          command: 'store.read',
          payload: {
            operation: 'list',
            resource: 'memory:dynamic',
          },
        },
      ),
    ).resolves.toMatchObject({
      entries: [{ key: 'memory:dynamic:thread-1:block:recent:000001' }],
    })
  })
})
