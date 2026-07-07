/**
 * Runtime Bridge manifest and WebSocket client helpers.
 *
 * These helpers are safe to call from application config. Bridge failures are
 * reported through the provided logger and must not interrupt user code.
 *
 * @module
 */

import {
  bridgeErrorCode,
  bridgeErrorDetails,
  bridgeErrorMessage,
  deriveBridgeCapabilities,
  executeRuntimeBridgeCommand,
} from './commands'
import {
  BridgeCommandRequestSchema,
  RuntimeBridgeConfigSchema,
  RuntimeBridgeManifestSchema,
  type BridgeCommandRequest,
  type RuntimeBridgeConnectOptions,
  type RuntimeBridgeConnection,
  type RuntimeBridgeManifest,
  type RuntimeBridgeManifestInput,
  type RuntimeBridgeManifestOptions,
  type RuntimeBridgeMessage,
  type RuntimeBridgeOptions,
  type RuntimeBridgeTransport,
  type RuntimeBridgeWebSocket,
  type RuntimeBridgeWebSocketConstructor,
} from './protocol'

/**
 * Derive the manifest advertised to the local service for the current runtime.
 *
 * Returns `undefined` when bridge config is omitted or explicitly disabled.
 */
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

  return RuntimeBridgeManifestSchema.parse({
    enabled: true,
    transport,
    url,
    endpointPath,
    runtimeName: explicitObject?.runtimeName,
    environment: options.environment ?? (transport === 'ws' ? 'node' : 'unknown'),
    labels: explicitObject?.labels,
    capabilities: deriveBridgeCapabilities(input),
  })
}

/**
 * Derive a framework bridge URL from a devtools server URL.
 *
 * HTTP transports preserve HTTP(S) schemes. WebSocket transports convert
 * HTTP(S) to WS(S) and append the runtime bridge endpoint path.
 */
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

/**
 * Connect a long-lived WebSocket runtime peer when bridge config allows it.
 *
 * Returns `undefined` when the bridge is disabled, uses an HTTP transport, or
 * no WebSocket implementation is available. The returned connection stops
 * heartbeats on explicit disposal or when the server closes the socket.
 */
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
      options.logger?.warn(`Crux Runtime Bridge send failed: ${bridgeErrorMessage(error)}`)
    }
  }

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
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
    options.logger?.warn(`Crux Runtime Bridge socket error: ${bridgeErrorMessage(event)}`)
  })
  addSocketListener(socket, 'close', () => {
    disposed = true
    stopHeartbeat()
  })

  return {
    peerId,
    dispose() {
      disposed = true
      stopHeartbeat()
      try {
        socket.close()
      } catch {
        // ignore close failures during teardown
      }
    },
  }
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
        message: bridgeErrorMessage(error),
        details: bridgeErrorDetails(error),
      },
    })
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
