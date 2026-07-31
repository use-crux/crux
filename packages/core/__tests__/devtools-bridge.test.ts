import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { config } from '../src/runtime/config'
import { blackboard } from '../src/agent/blackboard'
import {
  BridgeCommandRequestSchema,
  connectRuntimeBridge,
  deriveBridgeUrl,
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
  RuntimeBridgeConfigSchema,
  RuntimeBridgeMessageSchema,
  RuntimePeerHelloSchema,
} from '../src/runtime-bridge'
import { clearInspectableResources } from '../src/runtime-bridge/resources'
import { memory, recentMessages } from '../src/memory'
import { enableDevtools } from '../src/observability/devtools'
import { inMemoryRecordStore } from '../src/storage'
import { thread } from '../src/thread'

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

  serverClose() {
    this.readyState = 3
    this.onclose?.({})
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
            command: 'store.read',
            resources: [{ resource: 'crux.store', operations: ['get', 'list'] }],
          },
        ],
      },
    })

    expect(parsed.peer.environment).toBe('unknown')
    expect(parsed.peer.capabilities).toHaveLength(1)
  })

  it('parses store.read command requests and rejects eval.run', () => {
    expect(() =>
      BridgeCommandRequestSchema.parse({
        type: 'command.request',
        commandId: 'cmd_eval',
        command: 'eval.run',
        targetId: 'eval:writer',
        payload: {},
      }),
    ).toThrow()

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
      records: inMemoryRecordStore(),
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
        records: inMemoryRecordStore(),
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
        records: inMemoryRecordStore(),
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

  it('stops websocket heartbeats when the socket closes', () => {
    vi.useFakeTimers()
    try {
      connectRuntimeBridge(
        {
          devtools: {
            serverUrl: 'http://localhost:4400',
            bridge: { heartbeatMs: 1_000 },
          },
          records: inMemoryRecordStore(),
        },
        {
          WebSocket: FakeWebSocket,
          now: () => new Date('2026-07-07T12:00:00.000Z'),
        },
      )
      const socket = FakeWebSocket.instances[0]
      socket.open()
      vi.advanceTimersByTime(1_000)
      const sentBeforeClose = socket.sent.length

      socket.serverClose()
      vi.advanceTimersByTime(5_000)

      expect(socket.sent).toHaveLength(sentBeforeClose)
    } finally {
      vi.useRealTimers()
    }
  })

  it('executes store.read commands over the websocket peer', async () => {
    const records = inMemoryRecordStore()
    await records.put('memory:1', { key: 'memory:1', ok: true })
    connectRuntimeBridge(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: true,
        },
        records,
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
    const records = {
      ...inMemoryRecordStore(),
      async get() {
        throw new Error('store exploded')
      },
    }
    connectRuntimeBridge(
      {
        devtools: {
          serverUrl: 'http://localhost:4400',
          bridge: true,
        },
        records,
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
      storage: {
        records: inMemoryRecordStore(),
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
    const store = inMemoryRecordStore()
    memory({
      id: 'project-memory',
      namespace: 'project-1',
      records: store,
      blocks: [recentMessages({ id: 'recent' })],
    })
    blackboard({ id: 'thread', schema: z.object({ status: z.string().optional() }), records: store })

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
    const store = inMemoryRecordStore()
    const board = blackboard({ id: 'thread', schema: z.object({ status: z.string() }), records: store })
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

  it('returns payload-safe Thread tree, group, branch, and head topology', async () => {
    const records = inMemoryRecordStore()
    const conversation = thread({
      id: 'support/42',
      storage: { records },
    })
    await conversation.append({
      id: 'root',
      role: 'user',
      content: 'PRIVATE_ROOT_SENTINEL',
    })
    await conversation.append(
      { id: 'answer-a', role: 'assistant', content: 'PRIVATE_A_SENTINEL' },
      { after: 'root' },
    )
    await conversation.append(
      { id: 'answer-b', role: 'assistant', content: 'PRIVATE_B_SENTINEL' },
      { after: 'root' },
    )

    const result = await executeRuntimeBridgeCommand(
      {},
      {
        type: 'command.request',
        commandId: 'cmd_thread',
        command: 'store.read',
        payload: {
          operation: 'get',
          resource: 'thread:support%2F42',
        },
      },
    )

    expect(result).toMatchObject({
      schema: 1,
      threadId: 'support/42',
      state: 'live',
      heads: { main: 'answer-a' },
      tree: expect.arrayContaining([
        expect.objectContaining({ id: 'answer-a', parentId: 'root', role: 'assistant' }),
        expect.objectContaining({ id: 'answer-b', parentId: 'root', role: 'assistant' }),
        expect.objectContaining({ id: 'root', role: 'user' }),
      ]),
      branches: [
        expect.objectContaining({
          parentId: 'root',
          groupIds: expect.any(Array),
        }),
      ],
    })
    expect((result as { groups: unknown[] }).groups).toHaveLength(3)
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_ROOT_SENTINEL|PRIVATE_A_SENTINEL|PRIVATE_B_SENTINEL/,
    )
  })

  it('infers memory resources from trace ids when readable runtime records are available', async () => {
    const store = inMemoryRecordStore()
    await store.put('memory:dynamic:thread-1:block:recent:000001', { role: 'user', content: 'hello' })

    await expect(
      executeRuntimeBridgeCommand(
        { records: store },
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

describe('devtools helper bridge wiring', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    clearInspectableResources()
  })

  it('starts and disposes the websocket peer from enableDevtools()', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const disable = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
      bridge: true,
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    expect(socket?.url).toBe('ws://localhost:4400/ws/runtime')

    disable()
    expect(socket?.readyState).toBe(3)
  })

  it('does not connect a peer when bridge is omitted', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const disable = enableDevtools({
      prompts: [],
      serverUrl: 'http://localhost:4400',
    })

    expect(FakeWebSocket.instances).toHaveLength(0)
    disable()
  })
})
