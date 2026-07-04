import { v } from 'convex/values'
import type { ObjectType, PropertyValidators } from 'convex/values'
import { actionGeneric, internalActionGeneric, mutationGeneric, queryGeneric } from 'convex/server'
import {
  observe,
  type CapturedObservabilityContext,
  type CruxAttributes,
  type CruxPrimitiveName,
  type ObserveSpanOptions,
} from '@use-crux/core/observability'
import { createFlowId, getFlowSnapshot, signalFlow, type FlowResult, type FlowScope } from '@use-crux/core/flow'
import type { JsonValue } from '@use-crux/core/storage'
import { flushObservability } from './observability'
import {
  createConvexCoreFlowHandle,
  createConvexFlowSignalSender,
  getConvexFlowRuntimeContext,
  withConvexFlowRuntimeContext,
  type ConvexFlowSignalArgs,
  type ConvexFlowSignalName,
  type ConvexFlowSignals,
} from './server-flow'

const CRUX_ARG = '__crux'
const CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS = 1000
const DEFAULT_CONVEX_BOUNDARY_LEASE_MS = 11 * 60_000

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

type ConvexRunFn = (ref: unknown, args: Record<string, unknown>) => Promise<unknown>

type ConvexSchedulerLike = {
  runAfter: (delayMs: number, ref: unknown, args: Record<string, unknown>) => Promise<unknown>
}

type ConvexLikeCtx = object & {
  runAction?: unknown
  runQuery?: unknown
  runMutation?: unknown
  scheduler?: unknown
}

type ConvexObservabilityAttributes<TArgs extends Record<string, unknown>> =
  | CruxAttributes
  | ((args: TArgs) => CruxAttributes)

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
  observabilityAttributes?: ConvexObservabilityAttributes<TArgs>
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

/**
 * Definition object for a durable Convex flow.
 *
 * Convex flows keep the app-facing action wrapper shape while delegating
 * lifecycle, persistence, signal validation, and result semantics to the core
 * `flow()` runtime. `signals` is optional metadata; when present it types both
 * `scope.suspend()` in the handler and `handle.signal()` at call sites.
 *
 * @typeParam TCtx - Convex action context shape.
 * @typeParam TArgs - Public action arguments, also passed as flow input.
 * @typeParam TResult - Completed flow output.
 * @typeParam TSignals - Optional local signal map shared with core flows.
 */
export interface CruxServerFlowDefinition<
  TCtx,
  TArgs extends Record<string, unknown>,
  TResult,
  TSignals extends ConvexFlowSignals = undefined,
> {
  /** Human-readable flow name used for tracing and persisted snapshots. */
  name: string
  /** Convex action argument validators exposed by the generated action. */
  args: Record<string, unknown>
  /** Optional local signal contracts shared by suspend and signal calls. */
  signals?: TSignals
  /**
   * Procedural flow body.
   *
   * The `args` value is also available as `flow.input`; both are restored from
   * the persisted core snapshot when a Convex resume action runs.
   */
  handler: (flow: FlowScope<TArgs, TSignals>, args: TArgs, ctx: CruxAugmentedCtx<TCtx>) => TResult | Promise<TResult>
  /** Override or disable the observability flush after each flow action run. */
  observabilityFlushTimeoutMs?: number | false
}

/**
 * Handle returned by the Convex `flow()` adapter.
 *
 * The handle exposes a generated internal action plus direct helpers for tests,
 * wrappers, and mutation-side signal scheduling.
 */
export interface CruxServerFlowHandle<
  TCtx,
  TArgs extends Record<string, unknown>,
  TResult,
  TSignals extends ConvexFlowSignals = undefined,
> {
  /** Human-readable flow name. */
  readonly name: string
  /** Public action argument validators without the internal `resume` field. */
  readonly args: Record<string, unknown>
  /** Direct handler used by the generated action and by focused tests. */
  readonly handler: (ctx: CruxAugmentedCtx<TCtx>, args: TArgs & { resume?: string }) => Promise<FlowResult<TResult>>
  /** Convex internal action that starts or resumes the flow. */
  readonly action: WrappedConvexFunction<TCtx, TArgs & { resume?: string }, FlowResult<TResult>>
  /**
   * Persist a signal payload and schedule the resume action.
   *
   * When the flow declares `signals`, payloads are validated by the core flow
   * handle before the pending signal is written.
   */
  signal<TName extends ConvexFlowSignalName<TSignals>>(
    ctx: { scheduler?: ConvexSchedulerLike; crux?: CruxConvexContext },
    actionRef: unknown,
    flowId: string,
    signalName: TName,
    ...payload: ConvexFlowSignalArgs<TSignals, TName>
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
  observability?: CapturedObservabilityContext,
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
  const runAction = convexRunFn(ctx, 'runAction')
  const runQuery = convexRunFn(ctx, 'runQuery')
  const runMutation = convexRunFn(ctx, 'runMutation')
  const scheduler = convexScheduler(ctx)

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
      if (!runAction) {
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
          const result = (await runAction(ref, packCruxArgs(args, context, boundary))) as TResult
          span.end({ status: runStatusFromResult(result) ?? 'ok' })
          await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
          return result
        } catch (error) {
          span.error(error)
          await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
          throw error
        }
      })) as TResult
    },

    async runQuery<TResult = unknown>(_label: string, ref: unknown, args?: Record<string, unknown>): Promise<TResult> {
      if (!runQuery) {
        throw new Error('ctx.crux.runQuery() requires a Convex context with runQuery().')
      }
      return (await runQuery(ref, packCruxArgs(args, observe.captureContext()))) as TResult
    },

    async runMutation<TResult = unknown>(
      _label: string,
      ref: unknown,
      args?: Record<string, unknown>,
    ): Promise<TResult> {
      if (!runMutation) {
        throw new Error('ctx.crux.runMutation() requires a Convex context with runMutation().')
      }
      return (await runMutation(ref, packCruxArgs(args, observe.captureContext()))) as TResult
    },

    scheduler: scheduler
      ? {
          async runAfter<TResult = unknown>(
            label: string,
            delayMs: number,
            ref: unknown,
            args?: Record<string, unknown>,
            options?: { observability?: CapturedObservabilityContext },
          ): Promise<TResult> {
            const propagatedContext = options?.observability
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
                const currentSpanId =
                  propagatedContext?.currentSpanId ??
                  propagatedContext?.spanStack?.[propagatedContext.spanStack.length - 1]
                const boundary = currentSpanId
                  ? {
                      id: currentSpanId,
                      spanId: currentSpanId,
                      kind: 'schedule' as const,
                      label,
                      ref: String(ref),
                      parentSpanStack: propagatedContext?.spanStack
                        ? [...propagatedContext.spanStack]
                        : [currentSpanId],
                      leaseExpiresAt: boundaryLeaseExpiresAt(),
                    }
                  : undefined
                emitConvexBoundaryEvent('requested', boundary)
                await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
                return await scheduler.runAfter(delayMs, ref, packCruxArgs(args, propagatedContext, boundary))
              },
            )) as TResult
          },
        }
      : undefined,
  }
}

function convexRunFn(ctx: ConvexLikeCtx, key: 'runAction' | 'runQuery' | 'runMutation'): ConvexRunFn | undefined {
  const value = ctx[key]
  return typeof value === 'function' ? (value as ConvexRunFn) : undefined
}

function convexScheduler(ctx: ConvexLikeCtx): ConvexSchedulerLike | undefined {
  const value = ctx.scheduler
  if (!value || typeof value !== 'object') return undefined
  const runAfter = (value as { runAfter?: unknown }).runAfter
  return typeof runAfter === 'function' ? { runAfter: runAfter as ConvexSchedulerLike['runAfter'] } : undefined
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
    await flushObservability({ timeoutMs: CONVEX_BOUNDARY_START_FLUSH_TIMEOUT_MS })
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
    const attributes =
      typeof definition.observabilityAttributes === 'function'
        ? definition.observabilityAttributes(userArgs)
        : (definition.observabilityAttributes ?? {})
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

export function flow<
  TCtx extends ConvexLikeCtx,
  TArgs extends Record<string, unknown>,
  TResult,
  const TSignals extends ConvexFlowSignals = undefined,
>(
  definition: CruxServerFlowDefinition<TCtx, TArgs, TResult, TSignals>,
): CruxServerFlowHandle<TCtx, TArgs, TResult, TSignals> {
  const args = {
    ...definition.args,
    resume: v.optional(v.string()),
  }
  const signals = definition.signals as TSignals
  const signalSender = createConvexFlowSignalSender(definition.name, signals)
  const runtimeFlowHandle = createConvexCoreFlowHandle<TArgs, TResult, TSignals>(
    definition.name,
    signals,
    (scope, flowInput) => {
      const ctx = getConvexFlowRuntimeContext<CruxAugmentedCtx<TCtx>>(scope.flowId)
      if (!ctx) {
        throw new Error(`Convex flow \`${definition.name}\` is missing its Runtime Engine action context.`)
      }
      return definition.handler(scope, flowInput, ctx)
    },
  )

  const handler = async (
    ctx: CruxAugmentedCtx<TCtx>,
    actionArgs: TArgs & { resume?: string },
  ): Promise<FlowResult<TResult>> => {
    const { resume, ...input } = actionArgs
    const flowId = resume ?? createFlowId()
    const runFlow = runtimeFlowHandle.run as unknown as (
      flowInput: TArgs,
      options: { flowId: string },
    ) => Promise<FlowResult<TResult>>
    const result = await withConvexFlowRuntimeContext(flowId, ctx, async () =>
      resume ? await runtimeFlowHandle.resume(resume) : await runFlow(input as TArgs, { flowId }),
    )
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

  const handle: CruxServerFlowHandle<TCtx, TArgs, TResult, TSignals> = {
    name: definition.name,
    args: definition.args,
    handler,
    action: actionDefinition,

    async signal(ctx, actionRef, flowId, signalName, ...payload) {
      if (signalSender) {
        await signalSender.signal(flowId, signalName, ...(payload as JsonValue[]))
      } else {
        await signalFlow(flowId, signalName, (payload[0] ?? {}) as JsonValue)
      }
      const snapshot = await getFlowSnapshot(flowId)
      const resumeObservability = snapshot?.observabilityContext as CapturedObservabilityContext | undefined
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
