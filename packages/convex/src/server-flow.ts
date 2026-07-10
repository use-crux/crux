/**
 * Internal core-flow bridge for the Convex server adapter.
 *
 * Convex owns the action wrapper and scheduler integration; core owns flow
 * lifecycle, persistence, signal validation, and typed signal inference. This
 * module keeps that bridge isolated from the larger server boundary builder.
 *
 * @module
 */

import {
  flow as coreFlow,
  type FlowHandle,
  type FlowScope,
  type FlowSignalMap,
  type FlowSignalPayload,
} from '@use-crux/core/flow'
import type { JsonValue } from '@use-crux/core/storage'

/** Optional local signal map accepted by Convex flow definitions. */
export type ConvexFlowSignals = FlowSignalMap | undefined

/** Signal names accepted by a Convex flow handle. */
export type ConvexFlowSignalName<TSignals extends ConvexFlowSignals> = TSignals extends FlowSignalMap
  ? keyof TSignals & string
  : string

type ConvexFlowSignalPayloadArgs<TPayload> = [TPayload] extends [void] ? [] : [payload: TPayload]

/** Payload arguments accepted by a Convex flow handle's `.signal()` method. */
export type ConvexFlowSignalArgs<
  TSignals extends ConvexFlowSignals,
  TName extends string,
> = TSignals extends FlowSignalMap
  ? TName extends keyof TSignals
    ? ConvexFlowSignalPayloadArgs<FlowSignalPayload<TSignals[TName]>>
    : never
  : [payload?: JsonValue]

/** Minimal signal-writing surface used by the Convex scheduler wrapper. */
export interface ConvexFlowSignalSender {
  signal(flowId: string, signalName: string, ...args: JsonValue[]): Promise<void>
}

const runtimeFlowContexts = new Map<string, unknown[]>()

/** Procedural Convex flow body after action context has been captured. */
export type ConvexFlowBody<TArgs extends Record<string, unknown>, TResult, TSignals extends ConvexFlowSignals> = (
  flow: FlowScope<TArgs, TSignals>,
  input: TArgs,
) => TResult | Promise<TResult>

/** Run a Runtime Engine flow replay with the Convex action context for the durable flow id. */
export async function withConvexFlowRuntimeContext<T>(
  flowId: string | undefined,
  ctx: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!flowId) return await fn()
  const stack = runtimeFlowContexts.get(flowId) ?? []
  stack.push(ctx)
  runtimeFlowContexts.set(flowId, stack)
  try {
    return await fn()
  } finally {
    stack.pop()
    if (stack.length === 0) runtimeFlowContexts.delete(flowId)
  }
}

/** Resolve the Convex action context for a Runtime Engine flow replay. */
export function getConvexFlowRuntimeContext<TCtx>(flowId: string): TCtx | undefined {
  const stack = runtimeFlowContexts.get(flowId)
  return stack?.[stack.length - 1] as TCtx | undefined
}

/**
 * Create the core flow handle used for one Convex action invocation.
 *
 * The returned handle uses the accepted core API: `run(input)` for starts and
 * `resume(flowId)` for resumes. The adapter casts only at the boundary where
 * core's `FlowScope<unknown>` becomes the Convex action's typed input scope.
 */
export function createConvexCoreFlowHandle<
  TArgs extends Record<string, unknown>,
  TResult,
  TSignals extends ConvexFlowSignals,
>(
  name: string,
  signals: TSignals,
  body: ConvexFlowBody<TArgs, TResult, TSignals>,
): FlowHandle<TResult, TArgs, TSignals> {
  if (signals) {
    const signaledHandler = (scope: FlowScope<unknown, NonNullable<TSignals>>, input: TArgs) =>
      body(scope as unknown as FlowScope<TArgs, TSignals>, input)
    return coreFlow(name, { signals }, signaledHandler) as FlowHandle<TResult, TArgs, TSignals>
  }

  const unsignaledHandler = (scope: FlowScope<unknown, undefined>, input: TArgs) =>
    body(scope as unknown as FlowScope<TArgs, TSignals>, input)
  return coreFlow(name, unsignaledHandler) as FlowHandle<TResult, TArgs, TSignals>
}

/**
 * Create a signal-only core handle when Convex flow signals are declared.
 *
 * The handler is intentionally unreachable; core handle `.signal()` only needs
 * definition-time signal metadata so it can validate before persistence.
 */
export function createConvexFlowSignalSender<TSignals extends ConvexFlowSignals>(
  name: string,
  signals: TSignals,
): ConvexFlowSignalSender | undefined {
  if (!signals) return undefined

  const signalOnlyHandle = coreFlow(name, { signals }, async () => undefined)
  return signalOnlyHandle as ConvexFlowSignalSender
}
