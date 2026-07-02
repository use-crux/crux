/**
 * Fetch-compatible Runtime Engine handler factory.
 *
 * Generated and hand-written entry files call `createRuntimeHandler({
 * targets })` to expose a small Next-compatible `{ GET, POST }` surface.
 * Target discovery and code generation are optional DX layers over this API.
 *
 * @module
 */

import { getRuntime } from '../runtime'
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

/** Options for {@link createRuntimeHandler}. */
export interface CreateRuntimeHandlerOptions {
  /** Exported `flow()` handles and runtime `task()` targets. */
  readonly targets: readonly RuntimeHandlerTarget[]
  /** Runtime composer. Defaults to the globally configured `config({ runtime })`. */
  readonly runtime?: RuntimeEngineDefinition
  /** Override request verification. Defaults to the runtime's verifier or dev allowlist. */
  readonly verify?: RuntimeWakeRequestVerifier
  /** Override the work id generator for deterministic tests. */
  readonly newWorkId?: () => WorkId
  /** Hash of the generated runtime manifest, when codegen has produced one. */
  readonly manifestHash?: string
}

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
    options.runtime ?? getRuntime().runtimeEngine ?? missingRuntime()
  if (runtimeDefinition.kind === 'host-bound') {
    throw runtimeHostOnlyError({
      api: 'createRuntimeHandler()',
      host: runtimeDefinition.host,
      entry: runtimeDefinition.entry,
    })
  }
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeRuntimeHandlerTargets({
    targets: options.targets,
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

  const verify =
    options.verify ??
    runtimeDefinition.verifyWakeRequest ??
    allowUnsignedDevWake

  return Object.freeze({
    async GET(): Promise<Response> {
      return jsonResponse({
        ok: true,
        namespace: runtime.namespace,
        manifestHash: options.manifestHash ?? null,
        targets: Object.keys(targets).sort(),
      })
    },
    async POST(request: Request): Promise<Response> {
      return await handleWakeRequest(request, { runtime, verify })
    },
  })
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
