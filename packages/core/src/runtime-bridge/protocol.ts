/**
 * Runtime Bridge protocol schemas and inferred command-plane types.
 *
 * The bridge is the local-dev command plane from the Go service to a live
 * runtime peer. It is intentionally small and currently exposes registered
 * inspectable resources through `store.read`.
 *
 * @module
 */

import { z } from 'zod'
import {
  PromptPreviewCancelSchema,
  PromptPreviewCapabilitySchema,
  PromptPreviewRequestSchema,
} from './prompt-preview/protocol'

/** Supported transports for Runtime Bridge peers. */
export const RuntimeBridgeTransportSchema = z.enum(['ws', 'http'])
export type RuntimeBridgeTransport = z.infer<
  typeof RuntimeBridgeTransportSchema
>

/** User-facing `devtools.bridge` configuration accepted by Crux config. */
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

/** Environment label advertised by a runtime peer. */
export const BridgePeerEnvironmentSchema = z.enum([
  'node',
  'convex',
  'serverless',
  'browser',
  'unknown',
])
export type BridgePeerEnvironment = z.infer<typeof BridgePeerEnvironmentSchema>

/** Inspectable record-store resource advertised by a runtime peer. */
export const BridgeStoreResourceSchema = z.object({
  resource: z.string().min(1),
  operations: z.array(z.enum(['get', 'list'])).min(1),
  description: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type BridgeStoreResource = z.infer<typeof BridgeStoreResourceSchema>

/** Capability advertised by a runtime peer. */
const BridgeStoreCapabilitySchema = z.object({
  command: z.literal('store.read'),
  resources: z.array(BridgeStoreResourceSchema),
})
export const BridgeCapabilitySchema = z.discriminatedUnion('command', [
  BridgeStoreCapabilitySchema,
  PromptPreviewCapabilitySchema,
])
export type BridgeCapability = z.infer<typeof BridgeCapabilitySchema>

/** Runtime peer manifest discovered by the local service. */
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

/** Initial hello message sent by a runtime peer after connecting. */
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

/** Periodic liveness message sent by a WebSocket runtime peer. */
export const RuntimePeerHeartbeatSchema = z.object({
  type: z.literal('runtime.heartbeat'),
  peerId: z.string().min(1),
  timestamp: z.string().datetime(),
})
export type RuntimePeerHeartbeat = z.infer<typeof RuntimePeerHeartbeatSchema>

const ExactFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
const ExactFilterSchema = z.record(z.string(), ExactFilterValueSchema)

/** Payload accepted by the `store.read` bridge command. */
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
    filter: ExactFilterSchema.optional(),
  }),
])
export type StoreReadCommandPayload = z.infer<
  typeof StoreReadCommandPayloadSchema
>

/** Command request sent by the Go service to a runtime peer. */
const StoreReadCommandRequestSchema = z.object({
  type: z.literal('command.request'),
  commandId: z.string().min(1),
  command: z.literal('store.read'),
  payload: StoreReadCommandPayloadSchema,
  deadlineMs: z.number().int().positive().optional(),
})
export const BridgeCommandRequestSchema = z.discriminatedUnion('command', [
  StoreReadCommandRequestSchema,
  PromptPreviewRequestSchema,
])
export type BridgeCommandRequest = z.infer<typeof BridgeCommandRequestSchema>

/** Optional progress event emitted while a command is running. */
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

/** Successful command result message. */
export const BridgeCommandResultSchema = z.object({
  type: z.literal('command.result'),
  commandId: z.string().min(1),
  result: z.unknown(),
  runIds: z.array(z.string().min(1)).optional(),
  traceIds: z.array(z.string().min(1)).optional(),
})
export type BridgeCommandResult = z.infer<typeof BridgeCommandResultSchema>

/** Failed command result message with normalized error details. */
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

/** All messages that can cross the Runtime Bridge command channel. */
export const RuntimeBridgeMessageSchema = z.union([
  RuntimePeerHelloSchema,
  RuntimePeerHeartbeatSchema,
  BridgeCommandRequestSchema,
  PromptPreviewCancelSchema,
  BridgeCommandProgressSchema,
  BridgeCommandResultSchema,
  BridgeCommandErrorSchema,
])
export type RuntimeBridgeMessage = z.infer<typeof RuntimeBridgeMessageSchema>

/** Minimal config input used to derive bridge manifests and execute commands. */
export interface RuntimeBridgeManifestInput {
  readonly devtools?: {
    readonly serverUrl?: string
    readonly bridge?: RuntimeBridgeOptions
  }
  readonly records?: unknown
}

export interface RuntimeBridgeManifestOptions {
  /** Override the environment advertised in the derived manifest. */
  readonly environment?: BridgePeerEnvironment
  /** Override the transport advertised in the derived manifest. */
  readonly transport?: RuntimeBridgeTransport
  /** Framework-specific endpoint path, such as `/crux/bridge`. */
  readonly endpointPath?: string
}

/** Active bridge connection handle returned by `connectRuntimeBridge()`. */
export interface RuntimeBridgeConnection {
  readonly peerId: string
  /** Close the underlying transport and stop heartbeats. */
  dispose(): void
}

/** Minimal warning logger used by bridge helpers. */
export interface RuntimeBridgeLogger {
  warn(message: string): void
}

/** Runtime Bridge WebSocket connection options. */
export interface RuntimeBridgeConnectOptions extends RuntimeBridgeManifestOptions {
  readonly WebSocket?: RuntimeBridgeWebSocketConstructor
  readonly logger?: RuntimeBridgeLogger
  readonly now?: () => Date
}

export interface RuntimeBridgeWebSocketConstructor {
  new (url: string): RuntimeBridgeWebSocket
}

/** Minimal WebSocket shape used by the bridge client for browser and Node peers. */
export interface RuntimeBridgeWebSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener?(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: unknown) => void,
  ): void
  onopen?: ((event: unknown) => void) | null
  onmessage?: ((event: unknown) => void) | null
  onerror?: ((event: unknown) => void) | null
  onclose?: ((event: unknown) => void) | null
}
