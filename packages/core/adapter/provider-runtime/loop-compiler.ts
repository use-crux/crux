/**
 * Loop-owned provider runtime compiler.
 *
 * @internal
 * @module
 */

import type { ModelInfo } from '../../types'
import { executorAdapter } from '../define-executor'
import type { ExecutorSpec } from '../executor-spec'
import type { BoundLoopOwnedRuntime, DefinedProviderRuntime, LoopOwnedProviderRuntimeSpec } from './types'
import { createDefinedProviderRuntime } from './runtime-factory'

type AnyLoopOwnedRuntimeSpec = LoopOwnedProviderRuntimeSpec<unknown, unknown, unknown, unknown, object>

/**
 * Compile a public loop-owned provider runtime into the existing executor
 * runtime used by core policy.
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
  object
> {
  const { loop } = spec

  return createDefinedProviderRuntime(
    spec.id,
    (client: unknown) => {
      const bound = loop.bind(client, { id: spec.id })
      return executorAdapter(executorSpecForBoundLoop(spec.id, loop, bound))(client)
    },
    spec.extend,
  )
}

function executorSpecForBoundLoop(
  id: string,
  loop: AnyLoopOwnedRuntimeSpec['loop'],
  bound: BoundLoopOwnedRuntime<unknown, unknown, unknown>,
): ExecutorSpec<unknown, unknown, unknown, unknown> {
  const executorSpec: ExecutorSpec<unknown, unknown, unknown, unknown> = {
    executorId: id,
    describeModel: loop.describeModel ?? ((model) => describeModelFallback(id, model)),
    mapSettings: loop.settings ?? (() => ({})),
    runLoop: async (_client, request) => bound.run(request),
    attemptStructured: async (_client, request) => bound.attemptStructured(request),
    runStream: async (_client, request) => bound.stream(request),
  }

  if (bound.replayStream) executorSpec.replayStream = bound.replayStream
  return executorSpec
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
