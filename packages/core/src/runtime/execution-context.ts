/**
 * Internal execution metadata context.
 *
 * This is deliberately not an observability/span-parenting API. Canonical
 * run/span parenting belongs to `@use-crux/core/observability` via `observe`.
 * The execution context only carries SDK metadata that flows and helpers need
 * while code is running: session id, flow id, parent flow id, and step labels.
 */

import {
  createContextStorageResolver,
  runWithSynchronousContext,
} from '../shared/context-storage'

export interface ExecutionContext {
  traceId?: string
  sessionId?: string
  flowId?: string
  parentFlowId?: string
  stepId?: string
  stepLabel?: string
}

const contextStorage = createContextStorageResolver<ExecutionContext>()
const synchronousFallbackStack: ExecutionContext[] = []

export function runWithExecutionContext<R>(ctx: ExecutionContext, fn: () => R): R {
  const storage = contextStorage.getStorage()
  if (storage) return storage.run(ctx, fn)
  return runWithSynchronousContext(synchronousFallbackStack, ctx, fn)
}

export function getExecutionContext(): ExecutionContext | undefined {
  return contextStorage.getStorage()?.get() ?? synchronousFallbackStack.at(-1)
}

export function withSession<T>(sessionId: string, fn: () => T): T {
  const existing = getExecutionContext()
  return runWithExecutionContext({ ...existing, sessionId }, fn)
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
