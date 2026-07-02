import { v } from 'convex/values'
import { internalMutationGeneric } from 'convex/server'
import type {
  RuntimeHandlerTarget,
  RuntimeTarget,
  RuntimeTargetMap,
  RuntimeTargetRuntimeRef,
  WorkId,
} from '@use-crux/core/runtime'
import {
  bindHostRuntime,
  createRuntimeError,
  runtimeTargetMap,
} from '@use-crux/core/runtime'
import { convex, type ConvexRuntimeEngineDefinition } from '../runtime'
import type { ConvexCtxPort } from '../store'
import { convexRuntimeStore, type ConvexRuntimeComponent } from './store'

type ConvexSchedulerCtx = ConvexCtxPort & {
  scheduler: {
    runAfter(delayMs: number, ref: unknown, args: Record<string, unknown>): Promise<unknown>
  }
}

type ConvexMutationDefinition<TArgs extends Record<string, unknown>, TResult> = {
  args: Record<string, unknown>
  returns?: unknown
  handler: (ctx: ConvexSchedulerCtx, args: TArgs) => Promise<TResult>
}

type ConvexRegisteredMutation<TArgs extends Record<string, unknown>, TResult> = {
  _handler?: (ctx: ConvexSchedulerCtx, args: TArgs) => Promise<TResult>
}

type ConvexMutationBuilder = <TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexMutationDefinition<TArgs, TResult>,
) => ConvexRegisteredMutation<TArgs, TResult>

const internalMutation = internalMutationGeneric as ConvexMutationBuilder

/** Options accepted by {@link createConvexRuntimeHandlers}. */
export interface CreateConvexRuntimeHandlersOptions {
  /** Crux Convex component refs, normally `components.crux`. */
  readonly component: ConvexRuntimeComponent
  /** Exported `flow()` handles and runtime `task()` targets. */
  readonly targets: readonly RuntimeHandlerTarget[]
  /** Host-bound runtime declaration. Defaults to `convex()`. */
  readonly runtime?: ConvexRuntimeEngineDefinition
  /** Runtime namespace override for these handlers. */
  readonly namespace?: string
  /** Work id generator override for deterministic tests. */
  readonly newWorkId?: () => WorkId
}

/** Operational Convex Runtime Engine handlers for `convex/crux.ts`. */
export interface ConvexRuntimeHandlers {
  readonly handleWake: ConvexRegisteredMutation<{ envelope: unknown }, unknown>
  readonly deliverSignal: ConvexRegisteredMutation<
    { flowId: string; signalName: string; payload?: unknown; namespace?: string },
    unknown
  >
  readonly resumeFlow: ConvexRegisteredMutation<{ envelope: unknown }, unknown>
  readonly runTask: ConvexRegisteredMutation<
    { taskId: string; targetId: string; input?: unknown; namespace?: string },
    unknown
  >
  readonly fireTimer: ConvexRegisteredMutation<{ namespace?: string; now?: number }, unknown>
}

/** Create internal Convex handlers for runtime wake, signal, task, and timer operations. */
export function createConvexRuntimeHandlers(options: CreateConvexRuntimeHandlersOptions): ConvexRuntimeHandlers {
  const declaration = options.runtime ?? convex({ namespace: options.namespace })
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeTargets(options.targets, runtimeRef)

  const bind = (ctx: ConvexSchedulerCtx) => {
    const runtime = bindHostRuntime(declaration, {
      store: convexRuntimeStore({ ctx, component: options.component }),
      namespace: options.namespace,
      targets,
      newWorkId: options.newWorkId ?? createConvexWorkIdGenerator(),
      createWake: () => async (envelope) => {
        await ctx.scheduler.runAfter(0, handlers.handleWake, { envelope })
      },
      startMaintenance: false,
    })
    runtimeRef.current = runtime
    return runtime
  }

  const handlers: ConvexRuntimeHandlers = {
    handleWake: internalMutation({
      args: { envelope: v.any() },
      returns: v.any(),
      handler: async (ctx, { envelope }) => {
        const runtime = bind(ctx)
        try {
          return await runtime.kernel.handleWake(envelope as never)
        } finally {
          runtime.dispose()
        }
      },
    }),
    deliverSignal: internalMutation({
      args: {
        flowId: v.string(),
        signalName: v.string(),
        payload: v.optional(v.any()),
        namespace: v.optional(v.string()),
      },
      returns: v.any(),
      handler: async (ctx, { flowId, signalName, payload, namespace }) => {
        const runtime = bind(ctx)
        try {
          const result = await runtime.kernel.emitEvent({
            namespace: namespace ?? runtime.namespace,
            name: `crux.signal:${flowId}:${signalName}`,
            payload: (payload ?? {}) as never,
          })
          await runtime.dispatcher.nudge()
          return result
        } finally {
          runtime.dispose()
        }
      },
    }),
    resumeFlow: internalMutation({
      args: { envelope: v.any() },
      returns: v.any(),
      handler: async (ctx, { envelope }) => {
        const runtime = bind(ctx)
        try {
          return await runtime.kernel.handleWake(envelope as never)
        } finally {
          runtime.dispose()
        }
      },
    }),
    runTask: internalMutation({
      args: {
        taskId: v.string(),
        targetId: v.string(),
        input: v.optional(v.any()),
        namespace: v.optional(v.string()),
      },
      returns: v.any(),
      handler: async (ctx, { taskId, targetId, input, namespace }) => {
        const runtime = bind(ctx)
        try {
          const result = await runtime.kernel.enqueueTask({
            namespace: namespace ?? runtime.namespace,
            taskId: taskId as never,
            targetId: targetId as never,
            input: input as never,
          })
          await runtime.dispatcher.nudge()
          return result
        } finally {
          runtime.dispose()
        }
      },
    }),
    fireTimer: internalMutation({
      args: { namespace: v.optional(v.string()), now: v.optional(v.number()) },
      returns: v.any(),
      handler: async (ctx, { namespace, now }) => {
        const runtime = bind(ctx)
        try {
          const result = await runtime.kernel.scanTimers({
            namespace: namespace ?? runtime.namespace,
            now: now === undefined ? undefined : new Date(now),
          })
          await runtime.dispatcher.nudge()
          return result
        } finally {
          runtime.dispose()
        }
      },
    }),
  }

  return Object.freeze(handlers)
}

function normalizeTargets(
  targets: readonly RuntimeHandlerTarget[],
  runtimeRef: RuntimeTargetRuntimeRef,
): RuntimeTargetMap {
  const registeredTargets = runtimeTargetMap(runtimeRef)
  const entries: Array<[string, RuntimeTarget]> = []
  const seen = new Set<string>()
  for (const target of targets) {
    const name = 'name' in target ? target.name : target.targetId
    if (seen.has(name)) {
      throw createRuntimeError({
        code: 'TARGET_DUPLICATE',
        whatFailed: `Runtime target \`${name}\` is declared more than once.`,
        why: 'Convex runtime entries need one stable target for each durable name.',
        whatStillWorks: 'Other uniquely named runtime targets can still be discovered.',
        nextStep: 'Rename one target or remove the duplicate export before creating the Convex runtime handlers.',
      })
    }
    seen.add(name)
    const runtimeTarget = isRuntimeTarget(target) ? target : registeredTargets[name]
    if (runtimeTarget) entries.push([name, runtimeTarget])
  }
  return Object.freeze(Object.fromEntries(entries))
}

function isRuntimeTarget(target: RuntimeHandlerTarget): target is RuntimeTarget {
  return 'targetId' in target && 'kind' in target && 'execute' in target && typeof target.execute === 'function'
}

function createConvexWorkIdGenerator(): () => WorkId {
  let counter = 0
  return () => `work_convex_${Date.now().toString(36)}_${++counter}` as WorkId
}
