/**
 * Fetch-compatible Runtime Engine handler factory.
 *
 * Generated and hand-written entry files call `createRuntimeHandler()` with a
 * Runtime program or an explicit target list to expose a small Next-compatible
 * `{ GET, POST }` surface.
 * Target discovery and code generation are optional DX layers over this API.
 *
 * @module
 */

import { getHooks } from '../runtime'
import { createRuntime } from '../api/create-runtime'
import type {
  CreateRuntimeOptions,
  ResolvedRuntimeEngine,
} from '../api/create-runtime'
import {
  runtimeHostOnlyError,
  type RuntimeEngineDefinition,
} from '../api/runtime-definition'
import type { RuntimeTargetRuntimeRef } from '../api/target-registry'
import { createRuntimeError } from '../engine/errors'
import type { WorkId } from '../ports'
import type { RuntimeProgram } from '../program'
import { handleWakeRequest } from './core'
import {
  normalizeRuntimeHandlerTargets,
  type RuntimeHandlerTarget,
} from './targets'
import {
  allowUnsignedDevWake,
  type RuntimeWakeRequestVerifier,
} from './verify'

export type { RuntimeHandlerTarget } from './targets'

interface CreateRuntimeHandlerSharedOptions {
  /** Runtime composer. Defaults to the globally configured `config({ runtime })`. */
  readonly runtime?: RuntimeEngineDefinition
  /**
   * Override request verification.
   *
   * Production handlers require this option or a verifier supplied by the wake
   * adapter. Pass `allowUnsignedDevWake` only for trusted local endpoints.
   */
  readonly verify?: RuntimeWakeRequestVerifier
  /** Override the work id generator for deterministic tests. */
  readonly newWorkId?: () => WorkId
}

interface CreateRuntimeHandlerProgramInput {
  /** Immutable Runtime program whose targets and manifest hash are authoritative. */
  readonly program: RuntimeProgram
  /** Explicit targets cannot be combined with a Runtime program. */
  readonly targets?: never
  /** An explicit hash cannot override a Runtime program's manifest hash. */
  readonly manifestHash?: never
}

interface CreateRuntimeHandlerTargetsInput {
  /** Exported `flow()` handles and `durableTask()` targets. */
  readonly targets: readonly RuntimeHandlerTarget[]
  /** Hash of the generated runtime manifest, when codegen has produced one. */
  readonly manifestHash?: string
  /** A Runtime program cannot be combined with explicit targets. */
  readonly program?: never
}

/**
 * Mutually exclusive Runtime handler inputs plus shared runtime and verifier options.
 *
 * Supply either an immutable `program`, or the hand-written `targets` and
 * optional `manifestHash` form.
 */
export type CreateRuntimeHandlerOptions = CreateRuntimeHandlerSharedOptions &
  (CreateRuntimeHandlerProgramInput | CreateRuntimeHandlerTargetsInput)

/** Fetch-compatible runtime handler pair suitable for Next route exports. */
export interface RuntimeFetchHandlers {
  /** Health endpoint for setup and preflight. Contains no secrets. */
  GET(request: Request): Promise<Response>
  /** Signed wake endpoint for durable Runtime Engine work. */
  POST(request: Request): Promise<Response>
}

/** Create fetch-compatible runtime handlers for a target entry file. */
export function createRuntimeHandler(
  options: CreateRuntimeHandlerOptions,
): RuntimeFetchHandlers {
  const runtimeDefinition =
    options.runtime ?? getHooks().runtimeEngine ?? missingRuntime()
  if (runtimeDefinition.kind === 'host-bound') {
    throw runtimeHostOnlyError({
      api: 'createRuntimeHandler()',
      host: runtimeDefinition.host,
      entry: runtimeDefinition.entry,
    })
  }
  const verify = resolveWakeRequestVerifier(
    options.verify,
    runtimeDefinition.verifyWakeRequest,
  )
  const declaration = hasRuntimeProgram(options)
    ? {
        targets: options.program.targets,
        manifestHash: options.program.manifestHash,
      }
    : { targets: options.targets, manifestHash: options.manifestHash }
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeRuntimeHandlerTargets({
    targets: declaration.targets,
    runtimeRef,
    entry: 'createRuntimeHandler()',
  })
  const runtime = createRuntime({
    runtime: runtimeDefinition,
    targets,
    ...(options.newWorkId ? { newWorkId: options.newWorkId } : {}),
    startMaintenance: false,
  } satisfies CreateRuntimeOptions)
  runtimeRef.current = runtime

  return Object.freeze({
    async GET(): Promise<Response> {
      return jsonResponse({
        ok: true,
        namespace: runtime.namespace,
        manifestHash: declaration.manifestHash ?? null,
        targets: Object.keys(targets).sort(),
      })
    },
    async POST(request: Request): Promise<Response> {
      return await handleWakeRequest(request, { runtime, verify })
    },
  })
}

function hasRuntimeProgram(
  options: CreateRuntimeHandlerOptions,
): options is CreateRuntimeHandlerSharedOptions &
  CreateRuntimeHandlerProgramInput {
  return options.program !== undefined
}

function resolveWakeRequestVerifier(
  override: RuntimeWakeRequestVerifier | undefined,
  runtimeVerifier: RuntimeWakeRequestVerifier | undefined,
): RuntimeWakeRequestVerifier {
  if (override) return override
  if (runtimeVerifier) return runtimeVerifier
  if (isDevelopmentEnvironment()) return allowUnsignedDevWake

  throw createRuntimeError({
    code: 'WAKE_UNVERIFIED',
    whatFailed:
      'createRuntimeHandler() requires wake request verification in production.',
    why: 'No request verifier was supplied by the handler options or the configured wake adapter.',
    whatStillWorks:
      'Runtime handlers with signed wake adapters and local development handlers still work.',
    nextStep:
      'Pass verify: hmacWakeVerifier({ secret }) for signed requests, or pass verify: allowUnsignedDevWake explicitly for trusted local endpoints.',
  })
}

function isDevelopmentEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production'
  )
}

function missingRuntime(): never {
  throw createRuntimeError({
    code: 'RUNTIME_REQUIRED',
    whatFailed: 'createRuntimeHandler() requires a Crux runtime engine.',
    why: 'HTTP wake handlers need durable store and wake configuration before they can process work.',
    whatStillWorks:
      'Object-bound flows and local non-runtime Crux APIs still work.',
    nextStep:
      'Add runtime: serverless({ store: postgres(), wake: qstash() }) to crux.config.ts.',
  })
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}
