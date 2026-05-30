import { v } from 'convex/values'
import type { ObjectType, PropertyValidators } from 'convex/values'
import { actionGeneric, internalActionGeneric, mutationGeneric, queryGeneric } from 'convex/server'
import {
  observe,
  type CapturedObservabilityContext,
  type CruxAttributes,
  type CruxPrimitiveName,
  type ObserveSpanOptions,
} from '@crux/core/observability'
import { flow as coreFlow, getFlowSnapshot, signalFlow, type FlowResult, type FlowScope } from '@crux/core/flow'
import { flushObservability } from './observability'

const CRUX_ARG = '__crux'
const CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS = 1000
const DEFAULT_CONVEX_BOUNDARY_LEASE_MS = 90_000

export interface CruxEnvelope {
  v: 1
  observability?: CapturedObservabilityContext
  boundary?: CruxBoundaryEnvelope
}

export interface CruxBoundaryArgs {
  [CRUX_ARG]?: CruxEnvelope
}

export interface CruxBoundaryEnvelope {
  id: string
  spanId: string
  kind: 'action' | 'schedule'
  label: string
  ref: string
  parentSpanStack: string[]
  leaseExpiresAt?: string
}

export interface CruxConvexContext {
  capture(): CapturedObservabilityContext | undefined
  restore<T>(context: CapturedObservabilityContext | undefined, fn: () => T | Promise<T>): T | Promise<T>
  flush(options?: { timeoutMs?: number }): Promise<boolean>
  span<T>(options: ObserveSpanOptions, fn: () => T | Promise<T>): Promise<T>
  runAction<TResult = unknown>(label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult>
  runQuery<TResult = unknown>(label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult>
  runMutation<TResult = unknown>(label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult>
  scheduler?: {
    runAfter<TResult = unknown>(
      label: string,
      delayMs: number,
      ref: unknown,
      args?: Record<string, unknown>,
      options?: { observability?: CapturedObservabilityContext },
    ): Promise<TResult>
  }
}

type ConvexLikeCtx = {
  runAction?: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>
  runQuery?: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>
  runMutation?: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>
  scheduler?: {
    runAfter: (delayMs: number, ref: unknown, args: Record<string, unknown>) => Promise<unknown>
  }
}

// Convex's generic builders are parameterized by the app's generated DataModel,
// which this framework package intentionally cannot import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConvexBuilder = (definition: any) => object

export type CruxAugmentedCtx<TCtx> = TCtx & { crux: CruxConvexContext }

export interface ConvexFunctionDefinition<TCtx, TArgs extends Record<string, unknown>, TResult> {
  args?: Record<string, unknown>
  handler: (ctx: CruxAugmentedCtx<TCtx>, args: TArgs) => TResult | Promise<TResult>
  observabilityFlushTimeoutMs?: number | false
  /**
   * Human-readable run name used when this action/internal action starts a
   * Crux trace without incoming context. Defaults to the Convex boundary kind.
   */
  observabilityName?: string
  /**
   * Root primitive for standalone action traces. Use this for AI/runtime
   * entrypoints such as `agent.run` or scheduled task operations.
   */
  observabilityRootPrimitive?: CruxPrimitiveName
  /** Extra attributes attached to the standalone boundary run. */
  observabilityAttributes?: CruxAttributes
}

export interface WrappedConvexFunction<TCtx, TArgs extends Record<string, unknown>, TResult> {
  args: Record<string, unknown>
  handler: (ctx: TCtx, args: TArgs & CruxBoundaryArgs) => Promise<TResult>
  _handler?: (ctx: TCtx, args: TArgs & CruxBoundaryArgs) => Promise<TResult>
  isAction?: boolean
  isQuery?: boolean
  isMutation?: boolean
  isPublic?: boolean
  exportArgs?: () => unknown
}

type ConvexValidatorDefinition<TCtx, TArgsValidators extends PropertyValidators, TResult> = Omit<
  ConvexFunctionDefinition<TCtx, ObjectType<TArgsValidators>, TResult>,
  'args'
> & {
  args?: TArgsValidators
}

export interface CruxServerFlowDefinition<TCtx, TArgs extends Record<string, unknown>, TResult> {
  name: string
  args: Record<string, unknown>
  handler: (flow: FlowScope<TArgs>, args: TArgs, ctx: CruxAugmentedCtx<TCtx>) => TResult | Promise<TResult>
  observabilityFlushTimeoutMs?: number | false
}

export interface CruxServerFlowHandle<TCtx, TArgs extends Record<string, unknown>, TResult> {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly handler: (ctx: CruxAugmentedCtx<TCtx>, args: TArgs & { resume?: string }) => Promise<FlowResult<TResult>>
  readonly action: WrappedConvexFunction<TCtx, TArgs & { resume?: string }, FlowResult<TResult>>
  signal(
    ctx: Pick<ConvexLikeCtx, 'scheduler'> & Partial<{ crux: CruxConvexContext }>,
    actionRef: unknown,
    flowId: string,
    signalName: string,
    payload?: Record<string, unknown>,
  ): Promise<void>
}

function withCruxArg(args: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(args ?? {}),
    [CRUX_ARG]: v.optional(v.any()),
  }
}

function stripCruxArg<TArgs extends Record<string, unknown>>(args: TArgs & CruxBoundaryArgs): TArgs {
  const { [CRUX_ARG]: _crux, ...rest } = args
  return rest as TArgs
}

function packCruxArgs(
  args: Record<string, unknown> | undefined,
  observability = observe.captureContext(),
  boundary?: CruxBoundaryEnvelope,
): Record<string, unknown> {
  return {
    ...(args ?? {}),
    [CRUX_ARG]: {
      v: 1,
      observability,
      ...(boundary ? { boundary } : {}),
    },
  }
}

function boundaryLeaseExpiresAt(leaseMs = DEFAULT_CONVEX_BOUNDARY_LEASE_MS): string {
  return new Date(Date.now() + Math.max(1, leaseMs)).toISOString()
}

function runStatusFromResult(result: unknown): 'ok' | 'error' | 'cancelled' | 'suspended' | undefined {
  if (!result || typeof result !== 'object') return undefined
  const status = (result as { status?: unknown }).status
  switch (status) {
    case 'completed':
      return 'ok'
    case 'suspended':
      return 'suspended'
    case 'cancelled':
      return 'cancelled'
    case 'expired':
      return 'error'
    default:
      return undefined
  }
}

function emitConvexBoundaryEvent(
  name: 'requested' | 'received' | 'completed' | 'failed',
  boundary: CruxBoundaryEnvelope | undefined,
  attributes: CruxAttributes = {},
): void {
  if (!boundary) return
  observe.event({
    name: `runtime.convex.boundary.${name}`,
    attributes: {
      boundaryId: boundary.id,
      boundarySpanId: boundary.spanId,
      boundaryKind: boundary.kind,
      boundaryLabel: boundary.label,
      functionRef: boundary.ref,
      parentSpanStack: boundary.parentSpanStack,
      ...(boundary.leaseExpiresAt ? { leaseExpiresAt: boundary.leaseExpiresAt } : {}),
      ...attributes,
    },
  })
}

async function flushConvexObservability(timeoutMs: number | false | undefined): Promise<void> {
  if (timeoutMs === false) return
  await flushObservability(timeoutMs === undefined ? undefined : { timeoutMs })
}

function createCruxContext(ctx: ConvexLikeCtx): CruxConvexContext {
  return {
    capture() {
      return observe.captureContext()
    },

    restore(context, fn) {
      return observe.withContext(context, fn)
    },

    flush(options) {
      return flushObservability(options)
    },

    span(options, fn) {
      return observe.span(options, fn)
    },

    async runAction<TResult = unknown>(label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult> {
      if (!ctx.runAction) {
        throw new Error('ctx.crux.runAction() requires a Convex action context with runAction().')
      }
      const span = observe.openSpan({
        name: label,
        family: 'runtime',
        primitive: 'runtime.convex.action',
        attributes: {
          functionRef: String(ref),
          boundary: 'convex.action',
          presentation: { display: 'detail' },
        },
      })
      return (await span.withContext(async () => {
        const context = observe.captureContext()
        const boundary: CruxBoundaryEnvelope = {
          id: span.spanId,
          spanId: span.spanId,
          kind: 'action',
          label,
          ref: String(ref),
          parentSpanStack: context?.spanStack ? [...context.spanStack] : [span.spanId],
          leaseExpiresAt: boundaryLeaseExpiresAt(),
        }
        try {
          emitConvexBoundaryEvent('requested', boundary)
          await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
          const result = (await ctx.runAction!(ref, packCruxArgs(args, context, boundary))) as TResult
          span.end({ status: runStatusFromResult(result) ?? 'ok' })
          return result
        } catch (error) {
          span.error(error)
          throw error
        }
      })) as TResult
    },

    async runQuery<TResult = unknown>(_label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult> {
      if (!ctx.runQuery) {
        throw new Error('ctx.crux.runQuery() requires a Convex context with runQuery().')
      }
      return (await ctx.runQuery(ref, packCruxArgs(args))) as TResult
    },

    async runMutation<TResult = unknown>(
      _label: string,
      ref: unknown,
      args?: Record<string, unknown>,
    ): Promise<TResult> {
      if (!ctx.runMutation) {
        throw new Error('ctx.crux.runMutation() requires a Convex context with runMutation().')
      }
      return (await ctx.runMutation(ref, packCruxArgs(args))) as TResult
    },

    scheduler: ctx.scheduler
      ? {
          async runAfter<TResult = unknown>(
            label: string,
            delayMs: number,
            ref: unknown,
            args?: Record<string, unknown>,
            options?: { observability?: CapturedObservabilityContext },
          ): Promise<TResult> {
            return (await observe.span(
              {
                name: label,
                family: 'runtime',
                primitive: 'runtime.convex.schedule',
                attributes: {
                  functionRef: String(ref),
                  boundary: 'convex.schedule',
                  delayMs,
                  presentation: { display: 'detail' },
                },
              },
              async () => {
                const context = options?.observability ?? observe.captureContext()
                const currentSpanId = context?.currentSpanId ?? context?.spanStack?.[context.spanStack.length - 1]
                const boundary = currentSpanId
                  ? {
                      id: currentSpanId,
                      spanId: currentSpanId,
                      kind: 'schedule' as const,
                      label,
                      ref: String(ref),
                      parentSpanStack: context?.spanStack ? [...context.spanStack] : [currentSpanId],
                      leaseExpiresAt: boundaryLeaseExpiresAt(),
                    }
                  : undefined
                emitConvexBoundaryEvent('requested', boundary)
                await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
                return await ctx.scheduler!.runAfter(
                  delayMs,
                  ref,
                  packCruxArgs(args, context, boundary),
                )
              },
            )) as TResult
          },
        }
      : undefined,
  }
}

export function augmentCruxContext<TCtx extends ConvexLikeCtx>(ctx: TCtx): CruxAugmentedCtx<TCtx> {
  if ('crux' in ctx && ctx.crux) {
    return ctx as CruxAugmentedCtx<TCtx>
  }
  return Object.assign({}, ctx, { crux: createCruxContext(ctx) }) as CruxAugmentedCtx<TCtx>
}

async function runWithBoundary<T>(
  kind: 'action' | 'internalAction' | 'query' | 'mutation',
  name: string,
  rootPrimitive: CruxPrimitiveName,
  attributes: CruxAttributes,
  incoming: CapturedObservabilityContext | undefined,
  boundary: CruxBoundaryEnvelope | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (incoming) {
    return await observe.withContext(incoming, async () => {
      emitConvexBoundaryEvent('received', boundary)
      try {
        const result = await fn()
        const status = runStatusFromResult(result) ?? 'ok'
        emitConvexBoundaryEvent('completed', boundary, { status })
        return result
      } catch (error) {
        emitConvexBoundaryEvent('failed', boundary, {
          status: 'error',
          error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
        })
        throw error
      }
    })
  }
  if (kind === 'query' || kind === 'mutation') return await fn()

  const run = observe.openRun({
    name,
    rootPrimitive,
    attributes: {
      boundary: `convex.${kind}`,
      ...(kind === 'internalAction' ? { entrypoint: 'standalone-internal' } : {}),
      ...attributes,
    },
  })

  try {
    const result = await run.withContext(fn)
    run.end({ status: runStatusFromResult(result) ?? 'ok' })
    return result
  } catch (error) {
    run.error(error)
    throw error
  }
}

function createWrappedFunction<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  kind: 'action' | 'internalAction' | 'query' | 'mutation',
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult> {
  const args = withCruxArg(definition.args)
  const handler = async (ctx: TCtx, rawArgs: TArgs & CruxBoundaryArgs): Promise<TResult> => {
    const incomingEnvelope = rawArgs[CRUX_ARG]
    const incoming = incomingEnvelope?.observability
    const boundary = incomingEnvelope?.boundary
    const userArgs = stripCruxArg(rawArgs)
    const cruxCtx = augmentCruxContext(ctx)
    const boundaryName = definition.observabilityName ?? kind
    const rootPrimitive =
      definition.observabilityRootPrimitive ??
      (kind === 'action' || kind === 'internalAction' ? 'runtime.convex.action' : 'custom.operation')
    const attributes = definition.observabilityAttributes ?? {}
    try {
      return await runWithBoundary(kind, boundaryName, rootPrimitive, attributes, incoming, boundary, () =>
        Promise.resolve(definition.handler(cruxCtx, userArgs)),
      )
    } finally {
      if (kind === 'action' || kind === 'internalAction') {
        await flushConvexObservability(definition.observabilityFlushTimeoutMs)
      }
    }
  }

  const convexDefinition = { args, handler }
  const actionBuilder = actionGeneric as ConvexBuilder
  const internalActionBuilder = internalActionGeneric as ConvexBuilder
  const queryBuilder = queryGeneric as ConvexBuilder
  const mutationBuilder = mutationGeneric as ConvexBuilder
  const convexFn =
    kind === 'action'
      ? actionBuilder(convexDefinition)
      : kind === 'internalAction'
        ? internalActionBuilder(convexDefinition)
        : kind === 'query'
          ? queryBuilder(convexDefinition)
          : mutationBuilder(convexDefinition)

  return Object.assign(convexFn, { args, handler }) as WrappedConvexFunction<TCtx, TArgs, TResult>
}

export function action<TCtx extends ConvexLikeCtx, const TArgsValidators extends PropertyValidators, TResult>(
  definition: ConvexValidatorDefinition<TCtx, TArgsValidators, TResult>,
): WrappedConvexFunction<TCtx, ObjectType<TArgsValidators>, TResult>
export function action<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult>
export function action<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult> {
  return createWrappedFunction('action', definition)
}

export function internalAction<TCtx extends ConvexLikeCtx, const TArgsValidators extends PropertyValidators, TResult>(
  definition: ConvexValidatorDefinition<TCtx, TArgsValidators, TResult>,
): WrappedConvexFunction<TCtx, ObjectType<TArgsValidators>, TResult>
export function internalAction<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult>
export function internalAction<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult> {
  return createWrappedFunction('internalAction', definition)
}

export function query<TCtx extends ConvexLikeCtx, const TArgsValidators extends PropertyValidators, TResult>(
  definition: ConvexValidatorDefinition<TCtx, TArgsValidators, TResult>,
): WrappedConvexFunction<TCtx, ObjectType<TArgsValidators>, TResult>
export function query<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult>
export function query<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult> {
  return createWrappedFunction('query', { ...definition, observabilityFlushTimeoutMs: false })
}

export function mutation<TCtx extends ConvexLikeCtx, const TArgsValidators extends PropertyValidators, TResult>(
  definition: ConvexValidatorDefinition<TCtx, TArgsValidators, TResult>,
): WrappedConvexFunction<TCtx, ObjectType<TArgsValidators>, TResult>
export function mutation<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult>
export function mutation<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: ConvexFunctionDefinition<TCtx, TArgs, TResult>,
): WrappedConvexFunction<TCtx, TArgs, TResult> {
  return createWrappedFunction('mutation', { ...definition, observabilityFlushTimeoutMs: false })
}

export function cruxArgs(args: Record<string, unknown> = {}): Record<string, unknown> {
  return withCruxArg(args)
}

export function flow<TCtx extends ConvexLikeCtx, TArgs extends Record<string, unknown>, TResult>(
  definition: CruxServerFlowDefinition<TCtx, TArgs, TResult>,
): CruxServerFlowHandle<TCtx, TArgs, TResult> {
  const args = {
    ...definition.args,
    resume: v.optional(v.string()),
  }

  const handler = async (
    ctx: CruxAugmentedCtx<TCtx>,
    actionArgs: TArgs & { resume?: string },
  ): Promise<FlowResult<TResult>> => {
    const { resume, ...input } = actionArgs
    const flowHandle = coreFlow<TResult, TArgs>(definition.name, (scope) => definition.handler(scope, scope.input, ctx))
    const result = await flowHandle.run({
      input: input as TArgs,
      ...(resume ? { resume } : {}),
    })
    await flushConvexObservability(definition.observabilityFlushTimeoutMs)
    if (resume) {
      const status = runStatusFromResult(result)
      if (status && status !== 'suspended') {
        const context = observe.captureContext()
        if (context) observe.endRun(context, { status })
      }
    }
    return result
  }

  const actionDefinition = internalAction<TCtx, TArgs & { resume?: string }, FlowResult<TResult>>({
    args,
    handler,
    observabilityFlushTimeoutMs: definition.observabilityFlushTimeoutMs,
  })

  const handle: CruxServerFlowHandle<TCtx, TArgs, TResult> = {
    name: definition.name,
    args: definition.args,
    handler,
    action: actionDefinition,

    async signal(ctx, actionRef, flowId, signalName, payload = {}) {
      await signalFlow(flowId, signalName, payload)
      const snapshot = await getFlowSnapshot(flowId)
      const resumeObservability = snapshot?.observabilityContext
      if (ctx.crux?.scheduler) {
        await ctx.crux.scheduler.runAfter(
          `resume ${definition.name}`,
          0,
          actionRef,
          { resume: flowId },
          { observability: resumeObservability },
        )
        return
      }
      if (!ctx.scheduler) {
        throw new Error('flow.signal() requires a Convex context with scheduler.runAfter().')
      }
      await ctx.scheduler.runAfter(0, actionRef, packCruxArgs({ resume: flowId }, resumeObservability))
    },
  }

  return Object.freeze(handle)
}

export const capture = observe.captureContext
export const restore = observe.withContext
export const flush = flushObservability
