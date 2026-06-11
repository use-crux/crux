/**
 * Runtime Bridge contract for devtools command execution.
 *
 * The bridge is a dev-only control plane. It lets the Go devtools backend send
 * typed Crux-owned commands to a live runtime peer. Observability ingest remains
 * a separate runtime-to-Go telemetry plane.
 *
 * @module
 */

import { z } from 'zod'
import {
  getInspectableResource,
  listInspectableResources,
  type InspectableResource,
  type InspectableReadableStore,
} from './resources'
import { normalizeObservedError } from '../observability/errors'

export const RuntimeBridgeTransportSchema = z.enum(['ws', 'http'])
export type RuntimeBridgeTransport = z.infer<typeof RuntimeBridgeTransportSchema>

export const RuntimeBridgeConfigSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean().optional(),
    /**
     * Preferred URL used by the runtime or Go backend for command transport.
     *
     * WS peers connect to this URL. HTTP peers receive commands at this URL.
     * When omitted, Crux derives the URL from `serverUrl` and runtime-specific
     * defaults such as `/ws/runtime` or `/crux/bridge`.
     */
    url: z.string().min(1).optional(),
    /**
     * Alias for `url` when the caller wants to emphasize outbound WS connect
     * behavior. If both are present, `url` wins.
     */
    connectUrl: z.string().min(1).optional(),
    /**
     * Preferred transport. Long-lived Node runtimes usually use `ws`; Convex
     * and serverless route bindings usually use `http`.
     */
    transport: RuntimeBridgeTransportSchema.optional(),
    runtimeName: z.string().min(1).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    heartbeatMs: z.number().int().positive().optional(),
    reconnect: z
      .union([
        z.boolean(),
        z.object({
          minMs: z.number().int().positive().optional(),
          maxMs: z.number().int().positive().optional(),
        }),
      ])
      .optional(),
  }),
])
export type RuntimeBridgeOptions = z.infer<typeof RuntimeBridgeConfigSchema>

export const BridgeCommandNameSchema = z.enum(['eval.run', 'store.read'])
export type BridgeCommandName = z.infer<typeof BridgeCommandNameSchema>

export const BridgePeerEnvironmentSchema = z.enum(['node', 'convex', 'serverless', 'browser', 'unknown'])
export type BridgePeerEnvironment = z.infer<typeof BridgePeerEnvironmentSchema>

export const BridgeCapabilityTargetSchema = z.object({
  definitionId: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1).optional(),
})
export type BridgeCapabilityTarget = z.infer<typeof BridgeCapabilityTargetSchema>

export const BridgeStoreResourceSchema = z.object({
  resource: z.string().min(1),
  operations: z.array(z.enum(['get', 'list'])).min(1),
  description: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type BridgeStoreResource = z.infer<typeof BridgeStoreResourceSchema>

export const BridgeCapabilitySchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('eval.run'),
    targets: z.array(BridgeCapabilityTargetSchema),
  }),
  z.object({
    command: z.literal('store.read'),
    resources: z.array(BridgeStoreResourceSchema),
  }),
])
export type BridgeCapability = z.infer<typeof BridgeCapabilitySchema>

export const RuntimeBridgeManifestSchema = z.object({
  enabled: z.boolean(),
  transport: RuntimeBridgeTransportSchema,
  url: z.string().min(1).optional(),
  endpointPath: z.string().min(1).optional(),
  runtimeName: z.string().min(1).optional(),
  environment: BridgePeerEnvironmentSchema.default('unknown'),
  labels: z.record(z.string(), z.string()).optional(),
  capabilities: z.array(BridgeCapabilitySchema),
})
export type RuntimeBridgeManifest = z.infer<typeof RuntimeBridgeManifestSchema>

export const RuntimePeerHelloSchema = z.object({
  type: z.literal('runtime.hello'),
  peer: z.object({
    peerId: z.string().min(1).optional(),
    runtimeName: z.string().min(1),
    environment: BridgePeerEnvironmentSchema.default('unknown'),
    projectRoot: z.string().min(1).optional(),
    pid: z.number().int().positive().optional(),
    transport: RuntimeBridgeTransportSchema,
    endpointUrl: z.string().min(1).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    capabilities: z.array(BridgeCapabilitySchema),
    versions: z.record(z.string(), z.string()).optional(),
  }),
})
export type RuntimePeerHello = z.infer<typeof RuntimePeerHelloSchema>

export const RuntimePeerHeartbeatSchema = z.object({
  type: z.literal('runtime.heartbeat'),
  peerId: z.string().min(1),
  timestamp: z.string().datetime(),
})
export type RuntimePeerHeartbeat = z.infer<typeof RuntimePeerHeartbeatSchema>

export const EvalRunCommandPayloadSchema = z.object({
  suiteId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  caseIds: z.array(z.string().min(1)).optional(),
  persist: z.boolean().default(true).optional(),
})
export type EvalRunCommandPayload = z.infer<typeof EvalRunCommandPayloadSchema>

export const StoreReadCommandPayloadSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get'),
    resource: z.string().min(1),
    key: z.string().min(1).optional(),
  }),
  z.object({
    operation: z.literal('list'),
    resource: z.string().min(1),
    prefix: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    cursor: z.string().min(1).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
  }),
])
export type StoreReadCommandPayload = z.infer<typeof StoreReadCommandPayloadSchema>

export const BridgeCommandRequestSchema = z.discriminatedUnion('command', [
  z.object({
    type: z.literal('command.request'),
    commandId: z.string().min(1),
    command: z.literal('eval.run'),
    targetId: z.string().min(1),
    payload: EvalRunCommandPayloadSchema.default({}),
    deadlineMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('command.request'),
    commandId: z.string().min(1),
    command: z.literal('store.read'),
    payload: StoreReadCommandPayloadSchema,
    deadlineMs: z.number().int().positive().optional(),
  }),
])
export type BridgeCommandRequest = z.infer<typeof BridgeCommandRequestSchema>

export const BridgeCommandProgressSchema = z.object({
  type: z.literal('command.progress'),
  commandId: z.string().min(1),
  message: z.string().min(1).optional(),
  progress: z
    .object({
      current: z.number().nonnegative().optional(),
      total: z.number().positive().optional(),
      label: z.string().min(1).optional(),
    })
    .optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type BridgeCommandProgress = z.infer<typeof BridgeCommandProgressSchema>

export const BridgeCommandResultSchema = z.object({
  type: z.literal('command.result'),
  commandId: z.string().min(1),
  result: z.unknown(),
  runIds: z.array(z.string().min(1)).optional(),
  traceIds: z.array(z.string().min(1)).optional(),
})
export type BridgeCommandResult = z.infer<typeof BridgeCommandResultSchema>

export const BridgeCommandErrorSchema = z.object({
  type: z.literal('command.error'),
  commandId: z.string().min(1),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})
export type BridgeCommandError = z.infer<typeof BridgeCommandErrorSchema>

export const RuntimeBridgeMessageSchema = z.discriminatedUnion('type', [
  RuntimePeerHelloSchema,
  RuntimePeerHeartbeatSchema,
  BridgeCommandRequestSchema,
  BridgeCommandProgressSchema,
  BridgeCommandResultSchema,
  BridgeCommandErrorSchema,
])
export type RuntimeBridgeMessage = z.infer<typeof RuntimeBridgeMessageSchema>

export interface RuntimeBridgeManifestInput {
  readonly devtools?: {
    readonly serverUrl?: string
    readonly bridge?: RuntimeBridgeOptions
  }
  readonly eval?: unknown
  readonly quality?: {
    readonly id?: string
  }
  readonly store?: unknown
}

export interface RuntimeBridgeManifestOptions {
  readonly environment?: BridgePeerEnvironment
  readonly transport?: RuntimeBridgeTransport
  readonly endpointPath?: string
}

export interface RuntimeBridgeConnection {
  readonly peerId: string
  dispose(): void
}

export interface RuntimeBridgeLogger {
  warn(message: string): void
}

export interface RuntimeBridgeConnectOptions extends RuntimeBridgeManifestOptions {
  readonly WebSocket?: RuntimeBridgeWebSocketConstructor
  readonly logger?: RuntimeBridgeLogger
  readonly now?: () => Date
}

export interface RuntimeBridgeWebSocketConstructor {
  new (url: string): RuntimeBridgeWebSocket
}

export interface RuntimeBridgeWebSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener?(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void
  onopen?: ((event: unknown) => void) | null
  onmessage?: ((event: unknown) => void) | null
  onerror?: ((event: unknown) => void) | null
  onclose?: ((event: unknown) => void) | null
}

export function getRuntimeBridgeManifest(
  input: RuntimeBridgeManifestInput,
  options: RuntimeBridgeManifestOptions = {},
): RuntimeBridgeManifest | undefined {
  const bridge = input.devtools?.bridge
  if (bridge === undefined || bridge === false) return undefined

  const explicit = typeof bridge === 'object' ? RuntimeBridgeConfigSchema.parse(bridge) : undefined
  const explicitObject = explicit && typeof explicit === 'object' ? explicit : undefined
  if (explicitObject?.enabled === false) return undefined

  const transport = explicitObject?.transport ?? options.transport ?? 'ws'
  const endpointPath = options.endpointPath ?? (transport === 'http' ? '/crux/bridge' : '/ws/runtime')
  const url =
    explicitObject?.url ??
    explicitObject?.connectUrl ??
    deriveBridgeUrl(input.devtools?.serverUrl, transport, endpointPath)
  const capabilities = deriveBridgeCapabilities(input)

  return RuntimeBridgeManifestSchema.parse({
    enabled: true,
    transport,
    url,
    endpointPath,
    runtimeName: explicitObject?.runtimeName,
    environment: options.environment ?? (transport === 'ws' ? 'node' : 'unknown'),
    labels: explicitObject?.labels,
    capabilities,
  })
}

export function deriveBridgeUrl(
  serverUrl: string | undefined,
  transport: RuntimeBridgeTransport,
  endpointPath: string,
): string | undefined {
  if (!serverUrl) return undefined
  const base = serverUrl.replace(/\/+$/u, '')
  const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  if (transport === 'http') {
    if (base.startsWith('ws://')) return `http://${base.slice('ws://'.length)}${path}`
    if (base.startsWith('wss://')) return `https://${base.slice('wss://'.length)}${path}`
    return `${base}${path}`
  }
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}${path}`
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}${path}`
  return `${base}${path}`
}

export function connectRuntimeBridge(
  input: RuntimeBridgeManifestInput,
  options: RuntimeBridgeConnectOptions = {},
): RuntimeBridgeConnection | undefined {
  const manifest = getRuntimeBridgeManifest(input, options)
  if (!manifest || manifest.transport !== 'ws') return undefined
  if (!manifest.url) {
    options.logger?.warn('Crux Runtime Bridge is enabled, but no WebSocket URL could be derived.')
    return undefined
  }

  const WebSocketImpl = options.WebSocket ?? readGlobalWebSocket()
  if (!WebSocketImpl) {
    options.logger?.warn('Crux Runtime Bridge requires a WebSocket implementation in this runtime.')
    return undefined
  }

  const peerId = createBridgeId('peer')
  const socket = new WebSocketImpl(manifest.url)
  const now = options.now ?? (() => new Date())
  const heartbeatMs = bridgeHeartbeatMs(input.devtools?.bridge)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let disposed = false

  const send = (message: RuntimeBridgeMessage) => {
    if (disposed) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error) {
      options.logger?.warn(`Crux Runtime Bridge send failed: ${errorMessage(error)}`)
    }
  }

  const start = () => {
    send({
      type: 'runtime.hello',
      peer: {
        peerId,
        runtimeName: manifest.runtimeName ?? 'crux-runtime',
        environment: manifest.environment,
        transport: 'ws',
        endpointUrl: manifest.url,
        labels: manifest.labels,
        capabilities: manifest.capabilities,
      },
    })
    heartbeat = setInterval(() => {
      send({
        type: 'runtime.heartbeat',
        peerId,
        timestamp: now().toISOString(),
      })
    }, heartbeatMs)
  }

  const handleMessage = (event: unknown) => {
    void handleRuntimeBridgeSocketMessage(input, send, event)
  }

  addSocketListener(socket, 'open', start)
  addSocketListener(socket, 'message', handleMessage)
  addSocketListener(socket, 'error', (event) => {
    options.logger?.warn(`Crux Runtime Bridge socket error: ${errorMessage(event)}`)
  })

  return {
    peerId,
    dispose() {
      disposed = true
      if (heartbeat) clearInterval(heartbeat)
      try {
        socket.close()
      } catch {
        // ignore close failures during teardown
      }
    },
  }
}

function deriveBridgeCapabilities(input: RuntimeBridgeManifestInput): BridgeCapability[] {
  const capabilities: BridgeCapability[] = []

  // `eval.run` is part of the shared command contract, but runtime execution
  // is not wired in this slice. Do not advertise it as a peer capability until
  // the eval runner can actually execute it through the bridge.
  void input.eval

  const resources = deriveStoreResources(input)
  if (resources.length > 0) capabilities.push({ command: 'store.read', resources })

  return capabilities
}

async function handleRuntimeBridgeSocketMessage(
  input: RuntimeBridgeManifestInput,
  send: (message: RuntimeBridgeMessage) => void,
  event: unknown,
): Promise<void> {
  const data = readMessageData(event)
  if (typeof data !== 'string') return

  let parsed: BridgeCommandRequest
  try {
    parsed = BridgeCommandRequestSchema.parse(JSON.parse(data))
  } catch {
    return
  }

  try {
    const result = await executeRuntimeBridgeCommand(input, parsed)
    send({
      type: 'command.result',
      commandId: parsed.commandId,
      result,
    })
  } catch (error) {
    send({
      type: 'command.error',
      commandId: parsed.commandId,
      error: {
        code: bridgeErrorCode(error),
        message: errorMessage(error),
        details: bridgeErrorDetails(error),
      },
    })
  }
}

export async function executeRuntimeBridgeCommand(
  input: RuntimeBridgeManifestInput,
  command: BridgeCommandRequest,
): Promise<unknown> {
  switch (command.command) {
    case 'store.read':
      return await executeStoreRead(input, command.payload)
    case 'eval.run':
      throw new BridgeCommandExecutionError(
        'unsupported_command',
        'Runtime Bridge eval.run execution is not implemented in this runtime yet.',
      )
  }
}

async function executeStoreRead(input: RuntimeBridgeManifestInput, payload: StoreReadCommandPayload): Promise<unknown> {
  const explicitResource = getInspectableResource(payload.resource)
  if (explicitResource?.read) {
    if (payload.operation === 'get') {
      return await explicitResource.read({
        operation: 'get',
        key: payload.key,
        store: explicitResource.store ?? readableStore(input.store),
      })
    }
    return await explicitResource.read({
      operation: 'list',
      prefix: payload.prefix,
      options: {
        limit: Math.min(payload.limit ?? 100, 500),
        cursor: payload.cursor,
        filter: payload.filter,
      },
      store: explicitResource.store ?? readableStore(input.store),
    })
  }

  const store = explicitResource?.store ?? readableStore(input.store)
  if (!isReadableCruxStore(store)) {
    throw new BridgeCommandExecutionError('store_unavailable', 'No readable CruxStore is configured.')
  }

  const resolved = explicitResource ?? inferStoreResource(payload.resource)
  if (!resolved) {
    throw new BridgeCommandExecutionError('unsupported_resource', `Unsupported store resource "${payload.resource}".`)
  }
  if (payload.operation === 'get') {
    const key = payload.key ?? resolved.defaultKey
    if (!key) {
      throw new BridgeCommandExecutionError('missing_key', `Resource "${payload.resource}" requires a key.`)
    }
    return { value: await store.get(key) }
  }
  const prefix = payload.prefix ?? resolved.defaultPrefix
  if (prefix === undefined) {
    throw new BridgeCommandExecutionError('missing_prefix', `Resource "${payload.resource}" requires a list prefix.`)
  }
  return await store.list(prefix, {
    limit: Math.min(payload.limit ?? 100, 500),
    cursor: payload.cursor,
    filter: payload.filter,
  })
}

function deriveStoreResources(input: RuntimeBridgeManifestInput): BridgeStoreResource[] {
  const resources = new Map<string, BridgeStoreResource>()
  if (input.store) {
    resources.set('crux.store', {
      resource: 'crux.store',
      operations: ['get', 'list'],
      description: 'Configured CruxStore key-value resources',
      kind: 'store',
    })
  }
  for (const resource of listInspectableResources()) {
    resources.set(resource.resource, {
      resource: resource.resource,
      operations: [...resource.operations],
      description: resource.description,
      kind: resource.kind,
      metadata: resource.metadata,
    })
  }
  return [...resources.values()].sort((a, b) => a.resource.localeCompare(b.resource))
}

function inferStoreResource(
  resource: string,
): Pick<InspectableResource, 'resource' | 'defaultKey' | 'defaultPrefix'> | undefined {
  if (resource === 'crux.store') return { resource }
  if (resource.startsWith('blackboard:')) {
    return { resource, defaultKey: resource, defaultPrefix: resource }
  }
  if (resource.startsWith('memory:')) {
    return { resource, defaultPrefix: `${resource}:` }
  }
  return undefined
}

function readableStore(value: unknown): InspectableReadableStore | undefined {
  return isReadableCruxStore(value) ? value : undefined
}

function isReadableCruxStore(value: unknown): value is InspectableReadableStore {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function' &&
    typeof (value as { list?: unknown }).list === 'function'
  )
}

class BridgeCommandExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeCommandExecutionError'
  }
}

function bridgeErrorCode(error: unknown): string {
  return error instanceof BridgeCommandExecutionError ? error.code : 'runtime_error'
}

function bridgeErrorDetails(error: unknown): Record<string, unknown> {
  const errorKind = bridgeErrorCode(error)
  const phase = 'runtime_bridge.command'
  return {
    ...normalizeObservedError(error, {
      phase,
      errorKind,
    }),
    phase,
    errorKind,
  }
}

function bridgeHeartbeatMs(bridge: RuntimeBridgeOptions | undefined): number {
  if (!bridge || typeof bridge !== 'object') return 15_000
  return bridge.heartbeatMs ?? 15_000
}

function readGlobalWebSocket(): RuntimeBridgeWebSocketConstructor | undefined {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket
  return typeof candidate === 'function' ? (candidate as RuntimeBridgeWebSocketConstructor) : undefined
}

function addSocketListener(
  socket: RuntimeBridgeWebSocket,
  type: 'open' | 'message' | 'error' | 'close',
  listener: (event: unknown) => void,
): void {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener)
    return
  }
  switch (type) {
    case 'open':
      socket.onopen = listener
      break
    case 'message':
      socket.onmessage = listener
      break
    case 'error':
      socket.onerror = listener
      break
    case 'close':
      socket.onclose = listener
      break
  }
}

function readMessageData(event: unknown): unknown {
  if (event && typeof event === 'object' && 'data' in event) {
    return (event as { data: unknown }).data
  }
  return undefined
}

function createBridgeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown bridge error'
}
