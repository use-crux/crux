/**
 * Convex HTTP bridge binding for Crux devtools commands.
 *
 * Convex actions are request-scoped, so the bridge exposes an HTTP endpoint
 * that the Go devtools backend can call when it needs the live runtime to
 * execute a command such as `store.read`.
 *
 * @module
 */

import { httpActionGeneric } from 'convex/server'
import type { PublicHttpAction } from 'convex/server'
import type { Crux } from '@use-crux/core'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import type { ComponentApi } from './component/_generated/component'
import {
  assertConvexCtxPort,
  createDefaultConvexStorage,
} from './profile-store'
import {
  BridgeCommandResultSchema,
  PromptPreviewResultEnvelopeSchema,
  RuntimeBridgeManifestSchema,
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
  type RuntimeBridgeManifest,
} from '@use-crux/core/runtime-bridge'
import {
  parseBridgeCommandRequest,
  toBridgeCommandError,
} from './bridge-command'

export interface CruxConvexBridgeHttpRouter {
  route(
    definition:
      | {
          path: string
          method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE'
          handler: PublicHttpAction
        }
      | {
          pathPrefix: string
          method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE'
          handler: PublicHttpAction
        },
  ): void
}

export interface CruxConvexBridgeSetupOptions {
  /**
   * HTTP endpoint path for commands and manifest reads.
   *
   * @default '/crux/bridge'
   */
  path?: string
  /**
   * Optional ctx-aware storage factory.
   *
   * Convex storage usually needs the current function ctx, so real Convex apps
   * should pass `storage: (ctx) => convexStorage({ ctx, component })` unless
   * the Crux config already contains readable `persistence.records`.
   */
  storage?: (ctx: unknown) => Storage | Promise<Storage>
  /**
   * Crux Convex component ref. When provided, the bridge automatically creates
   * the default ctx-bound Storage bundle for each command request.
   */
  component?: ComponentApi
  /**
   * Override the public endpoint URL advertised to Go.
   */
  url?: string
}

export function setup(
  http: CruxConvexBridgeHttpRouter,
  crux: Crux,
  options: CruxConvexBridgeSetupOptions = {},
): void {
  const path = normalizePath(options.path ?? '/crux/bridge')

  http.route({
    path,
    method: 'GET',
    handler: httpActionGeneric(async (_ctx, request) =>
      jsonResponse(convexBridgeManifest(crux, options, request.url)),
    ),
  })

  http.route({
    path,
    method: 'POST',
    handler: httpActionGeneric(async (ctx, request) => {
      const parsed = await parseBridgeCommandRequest(request)
      if (!parsed.ok) return jsonResponse(parsed.error, 400)
      const command = parsed.command
      try {
        const records =
          command.command === 'store.read'
            ? await resolveBridgeRecords(ctx, crux, options)
            : undefined
        const result = await executeRuntimeBridgeCommand(
          { devtools: crux.config.devtools, records },
          command,
          { signal: request.signal },
        )
        const envelope = {
          type: 'command.result' as const,
          commandId: command.commandId,
          result,
        }
        return jsonResponse(
          command.command === 'prompt.previewExact'
            ? PromptPreviewResultEnvelopeSchema.parse(envelope)
            : BridgeCommandResultSchema.parse(envelope),
        )
      } catch (error) {
        return jsonResponse(toBridgeCommandError(command.commandId, error), 500)
      }
    }),
  })

  http.route({
    path,
    method: 'OPTIONS',
    handler: httpActionGeneric(
      async () => new Response(null, { status: 204, headers: bridgeHeaders() }),
    ),
  })
}

async function resolveBridgeRecords(
  ctx: unknown,
  crux: Crux,
  options: CruxConvexBridgeSetupOptions,
): Promise<RecordStore | undefined> {
  if (options.storage) return (await options.storage(ctx)).records
  if (options.component) {
    assertConvexCtxPort(ctx)
    return createDefaultConvexStorage(ctx, { component: options.component })
      .records
  }
  return crux.config.persistence?.records
}

function convexBridgeManifest(
  crux: Crux,
  options: CruxConvexBridgeSetupOptions,
  requestUrl?: string,
): RuntimeBridgeManifest | undefined {
  const configuredBridge = crux.config.devtools?.bridge ?? true
  const endpointUrl = options.url ?? requestUrl
  const manifest = getRuntimeBridgeManifest(
    {
      records: crux.config.persistence?.records,
      devtools: endpointUrl
        ? {
            ...crux.config.devtools,
            bridge: {
              ...(typeof configuredBridge === 'object' ? configuredBridge : {}),
              transport: 'http',
              url: endpointUrl,
            },
          }
        : {
            ...crux.config.devtools,
            bridge: configuredBridge,
          },
    },
    {
      environment: 'convex',
      transport: 'http',
      endpointPath: normalizePath(options.path ?? '/crux/bridge'),
    },
  )
  if (!manifest || (!options.storage && !options.component)) return manifest
  if (
    manifest.capabilities.some(
      (capability) => capability.command === 'store.read',
    )
  )
    return manifest

  return RuntimeBridgeManifestSchema.parse({
    ...manifest,
    capabilities: [
      ...manifest.capabilities,
      {
        command: 'store.read',
        resources: [
          {
            resource: 'crux.store',
            operations: ['get', 'list'],
            description: 'Convex-backed record resources',
            kind: 'store',
          },
        ],
      },
    ],
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: bridgeHeaders(),
  })
}

function bridgeHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}
