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
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from '../api/target-registry'
import { createRuntimeError } from '../engine/errors'
import type { RuntimeTarget, RuntimeTargetMap } from '../engine/kernel'
import type { WorkId } from '../ports'
import { handleWakeRequest } from './core'
import {
  allowUnsignedDevWake,
  type RuntimeWakeRequestVerifier,
} from './verify'

/** Runtime target accepted by generated or hand-written HTTP entry files. */
export type RuntimeHandlerTarget =
  | RuntimeTarget
  | {
      /** Stable target name returned by `flow()` handles and runtime `task()`. */
      readonly name: string
    }

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
  const targets = normalizeTargets(options.targets, runtimeRef)
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

function normalizeTargets(
  targets: readonly RuntimeHandlerTarget[],
  runtimeRef: RuntimeTargetRuntimeRef,
): RuntimeTargetMap {
  const registeredTargets = runtimeTargetMap(runtimeRef)
  const entries: Array<[string, RuntimeTarget]> = []
  const seen = new Set<string>()

  for (const target of targets) {
    const name = targetName(target)
    if (seen.has(name)) throw duplicateTargetError(name)
    seen.add(name)

    const runtimeTarget = isRuntimeTarget(target)
      ? target
      : registeredTargets[name]
    if (runtimeTarget) entries.push([name, runtimeTarget])
  }

  return Object.freeze(Object.fromEntries(entries))
}

function targetName(target: RuntimeHandlerTarget): string {
  return 'name' in target ? target.name : target.targetId
}

function isRuntimeTarget(target: RuntimeHandlerTarget): target is RuntimeTarget {
  return (
    'targetId' in target &&
    'kind' in target &&
    'execute' in target &&
    typeof target.execute === 'function'
  )
}

function duplicateTargetError(name: string): never {
  throw createRuntimeError({
    code: 'TARGET_DUPLICATE',
    whatFailed: `Runtime target \`${name}\` is declared more than once.`,
    why: 'Generated and hand-written runtime entries need one stable target for each durable name.',
    whatStillWorks:
      'Other uniquely named runtime targets can still be discovered.',
    nextStep:
      'Rename one target or remove the duplicate export before creating the runtime handler.',
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
