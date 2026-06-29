/**
 * Loop-owned provider runtime compiler.
 *
 * @internal
 * @module
 */

import type { ModelInfo } from '../../types'
import { loopRuntimeAdapter } from '../define-executor'
import type { BoundLoopRuntime, LoopRuntimePort } from '../loop-runtime-port'
import type { DefinedProviderRuntime, LoopOwnedProviderRuntimeSpec } from './types'
import { createDefinedProviderRuntime } from './runtime-factory'

type AnyLoopOwnedRuntimeSpec = LoopOwnedProviderRuntimeSpec<unknown, unknown, unknown, unknown, object>

/**
 * Compile a public loop-owned provider runtime into the executor runtime used
 * by core policy.
 *
 * For each bound client, the compiler assembles a {@link LoopRuntimePort} from
 * the contract's identity/settings hooks plus the client-dependent operations
 * returned by `loop.bind()`, then hands it straight to `loopRuntimeAdapter()`.
 * No intermediate per-call client threading remains.
 */
export function createLoopOwnedProviderRuntime(
  spec: AnyLoopOwnedRuntimeSpec,
): DefinedProviderRuntime<
  unknown,
  unknown,
  unknown,
  unknown,
  Record<string, unknown>,
  Record<string, never>,
  object,
  object,
  'loop-owned'
> {
  const { loop } = spec

  return createDefinedProviderRuntime(
    spec.id,
    'loop-owned',
    (client: unknown) => loopRuntimeAdapter(portForBoundLoop(spec.id, loop, loop.bind(client, { id: spec.id }))),
    spec.extend,
  )
}

function portForBoundLoop(
  id: string,
  loop: AnyLoopOwnedRuntimeSpec['loop'],
  bound: BoundLoopRuntime<unknown, unknown, unknown>,
): LoopRuntimePort<unknown, unknown, unknown> {
  const port: LoopRuntimePort<unknown, unknown, unknown> = {
    id,
    describeModel: loop.describeModel ?? ((model) => describeModelFallback(id, model)),
    mapSettings: loop.settings ?? (() => ({})),
    runTextLoop: (request) => bound.runTextLoop(request),
    runStructuredAttempt: (request) => bound.runStructuredAttempt(request),
    runStream: (request) => bound.runStream(request),
  }

  if (bound.replayStream) port.replayStream = (cached) => bound.replayStream!(cached)
  return port
}

function describeModelFallback<TModel>(runtimeId: string, model: TModel): ModelInfo {
  if (typeof model === 'string') {
    const separator = model.indexOf(':')
    if (separator > 0) {
      return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) }
    }
    return { provider: runtimeId, modelId: model }
  }

  if (typeof model === 'object' && model !== null) {
    const record = model as { readonly provider?: unknown; readonly modelId?: unknown; readonly id?: unknown }
    const provider = typeof record.provider === 'string' ? record.provider : runtimeId
    const modelId = typeof record.modelId === 'string' ? record.modelId : typeof record.id === 'string' ? record.id : ''
    return { provider, modelId }
  }

  return { provider: runtimeId, modelId: String(model) }
}
