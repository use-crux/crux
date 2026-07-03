/**
 * Serverless Runtime Engine composer.
 *
 * `serverless()` combines a durable store, an HTTP wake adapter, and endpoint
 * resolution for Next/Vercel-style deployments. It does not move correctness
 * into the transport; wake delivery remains a small at-least-once envelope.
 *
 * @module
 */

import type { CruxEngineCapabilities, RuntimeSetupPort } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { MAX_WAKE_ENVELOPE_BYTES } from '../engine/envelope'
import { createRuntimeError } from '../engine/errors'
import type { InProcessRuntimeEngineDefinition } from '../api/runtime-definition'
import type { RuntimeWakeAdapter } from './wake-adapter'

/** Environment values used by serverless public URL resolution. */
export interface ServerlessRuntimeEnvironment {
  readonly NODE_ENV?: string
  readonly CRUX_PUBLIC_URL?: string
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string
  readonly VERCEL_URL?: string
}

/** Options accepted by {@link serverless}. */
export interface ServerlessRuntimeOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Durable store adapter, such as `postgres()`. */
  readonly store: TStore
  /** Wake adapter, such as `qstash()` or `genericQueue()`. */
  readonly wake: RuntimeWakeAdapter
  /** Route path that hosts `createRuntimeHandler`. Defaults to `/api/crux`. */
  readonly endpoint?: string
  /** Explicit public base URL. Wins over environment inference. */
  readonly publicUrl?: string
  /** Runtime namespace. Defaults to environment or `local`. */
  readonly namespace?: string
  /** Environment override for tests and non-Node hosts. */
  readonly env?: ServerlessRuntimeEnvironment
}

/** Create a serverless Runtime Engine composer from store and wake adapters. */
export function serverless<TStore extends RuntimeStoreAdapter>(
  options: ServerlessRuntimeOptions<TStore>,
): InProcessRuntimeEngineDefinition<TStore> {
  const env = options.env ?? readProcessEnv()
  const endpoint = normalizeEndpoint(options.endpoint ?? '/api/crux')
  const url = resolveWakeUrl({
    endpoint,
    explicitPublicUrl: options.publicUrl,
    env,
  })

  return Object.freeze({
    kind: 'in-process' as const,
    id: `serverless:${options.wake.id}`,
    store: options.store,
    capabilities: serverlessCapabilities(options),
    namespace:
      options.namespace ??
      readStringEnv(env, 'CRUX_RUNTIME_NAMESPACE') ??
      'local',
    maintenance: { autoStart: false },
    ...(options.wake.verify
      ? { verifyWakeRequest: options.wake.verify }
      : {}),
    createWake() {
      return options.wake.createWake({ url })
    },
  })
}

function serverlessCapabilities(
  options: ServerlessRuntimeOptions,
): CruxEngineCapabilities {
  return Object.freeze({
    timers: Object.freeze({
      durable: true,
      ...(options.wake.capabilities.maxDelayMs
        ? { maxDelayMs: options.wake.capabilities.maxDelayMs }
        : {}),
    }),
    wake: Object.freeze({
      atLeastOnce: true,
      signed: options.wake.capabilities.signed,
      maxPayloadBytes:
        options.wake.capabilities.maxPayloadBytes ??
        MAX_WAKE_ENVELOPE_BYTES,
    }),
    events: Object.freeze({ durable: true, cursorReads: true }),
    waiters: Object.freeze({ durable: true }),
    leases: Object.freeze({ durable: true }),
    live: Object.freeze({ available: false }),
    setup: Object.freeze(setupCapabilities(options.store)),
    deployment: Object.freeze({
      serverless: 'supported',
      edge: 'requires-configuration',
      multiProcess: 'supported',
    }),
  })
}

function setupCapabilities(store: RuntimeStoreAdapter): {
  readonly canCheck: boolean
  readonly canApply: boolean
} {
  const setup = setupPort(store)
  return {
    canCheck: Boolean(setup?.check),
    canApply: Boolean(setup?.apply),
  }
}

function setupPort(store: RuntimeStoreAdapter): RuntimeSetupPort | undefined {
  return 'setup' in store ? (store.setup as RuntimeSetupPort) : undefined
}

function resolveWakeUrl(options: {
  readonly endpoint: string
  readonly explicitPublicUrl?: string
  readonly env: ServerlessRuntimeEnvironment
}): string {
  const base =
    options.explicitPublicUrl ??
    options.env.CRUX_PUBLIC_URL ??
    vercelUrl(options.env)
  if (base) return `${normalizeBaseUrl(base)}${options.endpoint}`

  if (options.env.NODE_ENV === 'production') {
    throw createRuntimeError({
      code: 'PUBLIC_URL_UNRESOLVED',
      whatFailed: 'serverless() could not resolve a public runtime wake URL.',
      why: 'Production HTTP wake delivery needs a stable absolute URL.',
      whatStillWorks:
        'Local node() runtime execution and object-bound flow APIs still work.',
      nextStep:
        'Set CRUX_PUBLIC_URL or pass serverless({ publicUrl: "https://..." }).',
    })
  }

  return `http://localhost${options.endpoint}`
}

function vercelUrl(env: ServerlessRuntimeEnvironment): string | undefined {
  const value =
    env.NODE_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : env.VERCEL_URL
  return value
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`
}

function normalizeBaseUrl(url: string): string {
  const withProtocol = /^https?:\/\//.test(url) ? url : `https://${url}`
  return withProtocol.replace(/\/+$/, '')
}

function readProcessEnv(): ServerlessRuntimeEnvironment {
  return typeof process === 'undefined' ? {} : process.env
}

function readStringEnv(
  env: ServerlessRuntimeEnvironment,
  key: 'CRUX_RUNTIME_NAMESPACE',
): string | undefined {
  const record = env as Record<string, string | undefined>
  return record[key]
}
