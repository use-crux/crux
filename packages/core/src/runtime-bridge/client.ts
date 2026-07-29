/**
 * Runtime Bridge manifest and WebSocket client helpers.
 *
 * These helpers are safe to call from application config. Bridge failures are
 * reported through the provided logger and must not interrupt user code.
 *
 * @module
 */

import { deriveBridgeCapabilities } from './commands'
import { createRuntimeBridgeWebSocketConnection } from './websocket-connection'
import {
  RuntimeBridgeConfigSchema,
  RuntimeBridgeManifestSchema,
  type RuntimeBridgeConnectOptions,
  type RuntimeBridgeConnection,
  type RuntimeBridgeManifest,
  type RuntimeBridgeManifestInput,
  type RuntimeBridgeManifestOptions,
  type RuntimeBridgeTransport,
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

  const explicit =
    typeof bridge === 'object'
      ? RuntimeBridgeConfigSchema.parse(bridge)
      : undefined
  const explicitObject =
    explicit && typeof explicit === 'object' ? explicit : undefined
  if (explicitObject?.enabled === false) return undefined

  const transport = explicitObject?.transport ?? options.transport ?? 'ws'
  const endpointPath =
    options.endpointPath ??
    (transport === 'http' ? '/crux/bridge' : '/ws/runtime')
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
    environment:
      options.environment ?? (transport === 'ws' ? 'node' : 'unknown'),
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
    if (base.startsWith('ws://'))
      return `http://${base.slice('ws://'.length)}${path}`
    if (base.startsWith('wss://'))
      return `https://${base.slice('wss://'.length)}${path}`
    return `${base}${path}`
  }
  if (base.startsWith('https://'))
    return `wss://${base.slice('https://'.length)}${path}`
  if (base.startsWith('http://'))
    return `ws://${base.slice('http://'.length)}${path}`
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
    options.logger?.warn(
      'Crux Runtime Bridge is enabled, but no WebSocket URL could be derived.',
    )
    return undefined
  }

  const WebSocketImpl = options.WebSocket ?? readGlobalWebSocket()
  if (!WebSocketImpl) {
    options.logger?.warn(
      'Crux Runtime Bridge requires a WebSocket implementation in this runtime.',
    )
    return undefined
  }

  return createRuntimeBridgeWebSocketConnection(
    input,
    options,
    WebSocketImpl,
    () => getRuntimeBridgeManifest(input, options),
  )
}

function readGlobalWebSocket(): RuntimeBridgeWebSocketConstructor | undefined {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket
  return typeof candidate === 'function'
    ? (candidate as RuntimeBridgeWebSocketConstructor)
    : undefined
}
