import { v } from 'convex/values'
import { internalActionGeneric } from 'convex/server'
import type {
  ResolvedRuntimeEngine,
  RuntimeHandlerTarget,
  RuntimeTargetRuntimeRef,
  WakeEnvelope,
} from '@use-crux/core/runtime'
import { bindHostRuntime, normalizeRuntimeHandlerTargets } from '@use-crux/core/runtime'
import { augmentCruxContext } from '../server'
import { withConvexFlowRuntimeContext } from '../server-flow'
import type { ConvexCtxPort } from '../store'
import { convex } from './definition'
import { createConvexWorkIdGenerator, decodeConvexWakeEnvelope } from './helpers'
import type { CreateConvexRuntimeHandlersOptions } from './handlers'
import { convexRuntimeStore } from './store'

type ConvexActionCtx = ConvexCtxPort & {
  scheduler: {
    runAfter(delayMs: number, ref: unknown, args: Record<string, unknown>): Promise<unknown>
  }
}

type ConvexActionDefinition<TArgs extends Record<string, unknown>, TResult> = {
  args: Record<string, unknown>
  returns?: unknown
  handler: (ctx: ConvexActionCtx, args: TArgs) => Promise<TResult>
}

type ConvexRegisteredAction<TArgs extends Record<string, unknown>, TResult> = {
  _handler?: (ctx: ConvexActionCtx, args: TArgs) => Promise<TResult>
}

type ConvexActionBuilder = <TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexActionDefinition<TArgs, TResult>,
) => ConvexRegisteredAction<TArgs, TResult>

const internalAction = internalActionGeneric as ConvexActionBuilder

/** Generated Node action that imports and executes runtime target modules. */
export interface ConvexRuntimeTargetExecutor {
  readonly executeTarget: ConvexRegisteredAction<{ envelope: unknown }, unknown>
}

/** Options accepted by {@link createConvexRuntimeTargetExecutor}. */
export interface CreateConvexRuntimeTargetExecutorOptions extends Omit<
  CreateConvexRuntimeHandlersOptions,
  'targetExecutor' | 'targets'
> {
  /** Exported Convex `flow()` handles, core `flow()` handles, and `durableTask()` targets. */
  readonly targets: readonly RuntimeHandlerTarget[]
}

/** Create the generated Node action that executes Convex runtime target modules. */
export function createConvexRuntimeTargetExecutor(
  options: CreateConvexRuntimeTargetExecutorOptions,
): ConvexRuntimeTargetExecutor {
  const declaration = options.runtime ?? convex({ namespace: options.namespace })
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeRuntimeHandlerTargets({
    targets: options.targets,
    runtimeRef,
    entry: 'createConvexRuntimeTargetExecutor()',
  })

  const bind = (ctx: ConvexActionCtx) => {
    const runtime = bindHostRuntime(declaration, {
      store: convexRuntimeStore({ ctx, component: options.component }),
      namespace: options.namespace,
      targets,
      newWorkId: options.newWorkId ?? createConvexWorkIdGenerator(),
      createWake: () => async (envelope) => {
        await ctx.scheduler.runAfter(0, executor.executeTarget, { envelope })
      },
      startMaintenance: false,
    })
    runtimeRef.current = runtime
    return runtime
  }

  const executor: ConvexRuntimeTargetExecutor = {
    executeTarget: internalAction({
      args: { envelope: v.any() },
      returns: v.any(),
      handler: async (ctx, { envelope }) => {
        const wakeEnvelope = decodeConvexWakeEnvelope(envelope)
        const runtime = bind(ctx)
        try {
          const flowId = await flowIdForWake(runtime, wakeEnvelope)
          const result = await withConvexFlowRuntimeContext(flowId, augmentCruxContext(ctx), async () =>
            runtime.kernel.handleWake(wakeEnvelope),
          )
          await runtime.dispatcher.nudge()
          return result
        } finally {
          runtime.dispose()
        }
      },
    }),
  }

  return Object.freeze(executor)
}

async function flowIdForWake(runtime: ResolvedRuntimeEngine, envelope: WakeEnvelope): Promise<string | undefined> {
  const work = await runtime.store.state.getWork(envelope.workId, { namespace: envelope.ns })
  switch (work?.work.kind) {
    case 'flow.resume':
    case 'flow.timeout':
      return work.work.flowId
    default:
      return undefined
  }
}
