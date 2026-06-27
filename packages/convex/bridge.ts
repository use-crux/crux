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
import { normalizeObservedError } from '@use-crux/core/observability'
import type { CruxStore } from '@use-crux/core/store'
import type { ComponentApi } from './src/component/_generated/component'
import { assertConvexCtxPort, createDefaultConvexCruxStore } from './profile-store'
import {
  BridgeCommandErrorSchema,
  BridgeCommandRequestSchema,
  BridgeCommandResultSchema,
  RuntimeBridgeManifestSchema,
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
  type BridgeCommandError,
  type RuntimeBridgeManifest,
} from '@use-crux/core/runtime-bridge'

export interface CruxConvexBridgeHttpRouter {
  route(definition: { path: string; method: 'GET' | 'POST' | 'OPTIONS'; handler: PublicHttpAction }): void
}

export interface CruxConvexBridgeSetupOptions {
  /**
   * HTTP endpoint path for commands and manifest reads.
   *
   * @default '/crux/bridge'
   */
  path?: string
  /**
   * Optional ctx-aware store factory.
   *
   * Convex stores usually need the current function ctx, so real Convex apps
   * should pass `store: (ctx) => cruxDocuments.store(ctx)` unless the Crux
   * config already contains a readable `persistence.store`.
   */
  store?: (ctx: unknown) => CruxStore | Promise<CruxStore>
  /**
   * Crux Convex component ref. When provided, the bridge automatically creates
   * the default ctx-bound CruxStore for each command request.
   */
  component?: ComponentApi
  /**
   * Override the public endpoint URL advertised to Go.
   */
  url?: string
}

export function setup(http: CruxConvexBridgeHttpRouter, crux: Crux, options: CruxConvexBridgeSetupOptions = {}): void {
  const path = normalizePath(options.path ?? '/crux/bridge')

  http.route({
    path,
    method: 'GET',
    handler: httpActionGeneric(async (_ctx, request) => jsonResponse(convexBridgeManifest(crux, options, request.url))),
  })

  http.route({
    path,
    method: 'POST',
    handler: httpActionGeneric(async (ctx, request) => {
      const parsed = await parseBridgeCommandRequest(request)
      if (!parsed.ok) return jsonResponse(parsed.error, 400)
      const command = parsed.command
      try {
        const store = await resolveBridgeStore(ctx, crux, options)
        const result = await executeRuntimeBridgeCommand(
          { devtools: crux.config.devtools, quality: crux.config.quality, store },
          command,
        )
        return jsonResponse(
          BridgeCommandResultSchema.parse({
            type: 'command.result',
            commandId: command.commandId,
            result,
          }),
        )
      } catch (error) {
        return jsonResponse(toBridgeCommandError(command.commandId, error), 500)
      }
    }),
  })

  http.route({
    path,
    method: 'OPTIONS',
    handler: httpActionGeneric(async () => new Response(null, { status: 204, headers: bridgeHeaders() })),
  })
}

async function parseBridgeCommandRequest(
  request: Request,
): Promise<
  { ok: true; command: ReturnType<typeof BridgeCommandRequestSchema.parse> } | { ok: false; error: BridgeCommandError }
> {
  let body: unknown
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : undefined
  } catch (error) {
    return {
      ok: false,
      error: toBridgeCommandError('invalid_request', {
        code: 'invalid_json',
        message: `Request body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      }),
    }
  }

  try {
    return { ok: true, command: BridgeCommandRequestSchema.parse(body) }
  } catch (error) {
    return {
      ok: false,
      error: toBridgeCommandError('invalid_request', {
        code: 'invalid_command',
        message: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}

async function resolveBridgeStore(
  ctx: unknown,
  crux: Crux,
  options: CruxConvexBridgeSetupOptions,
): Promise<CruxStore | undefined> {
  if (options.store) return await options.store(ctx)
  if (options.component) {
    assertConvexCtxPort(ctx)
    return createDefaultConvexCruxStore(ctx, { component: options.component })
  }
  return crux.config.persistence?.store
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
      quality: crux.config.quality,
      store: crux.config.persistence?.store,
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
  if (!manifest || (!options.store && !options.component)) return manifest
  if (manifest.capabilities.some((capability) => capability.command === 'store.read')) return manifest

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
            description: 'Convex-backed CruxStore resources',
            kind: 'store',
          },
        ],
      },
    ],
  })
}

function toBridgeCommandError(commandId: string, error: unknown): BridgeCommandError {
  const explicit = isRecord(error) ? error : undefined
  const explicitCode = typeof explicit?.code === 'string' ? explicit.code : undefined
  const explicitMessage = typeof explicit?.message === 'string' ? explicit.message : undefined
  const errorKind = explicitCode ?? 'runtime_error'
  const phase = 'runtime_bridge.command'
  return BridgeCommandErrorSchema.parse({
    type: 'command.error',
    commandId,
    error: {
      code: errorKind,
      message: explicitMessage ?? (error instanceof Error ? error.message : String(error)),
      details: {
        ...normalizeObservedError(error, {
          phase,
          errorKind,
        }),
        phase,
        errorKind,
      },
    },
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
