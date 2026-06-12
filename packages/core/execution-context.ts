/**
 * Internal execution metadata context.
 *
 * This is deliberately not an observability/span-parenting API. Canonical
 * run/span parenting belongs to `@crux/core/observability` via `observe`.
 * The execution context only carries SDK metadata that flows and helpers need
 * while code is running: session id, flow id, parent flow id, and step labels.
 */

export interface ExecutionContext {
  traceId?: string
  sessionId?: string
  flowId?: string
  parentFlowId?: string
  stepId?: string
  stepLabel?: string
}

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

let als: AsyncLocalStorageLike<ExecutionContext> | null = null
let alsInitialized = false

function getAls(): AsyncLocalStorageLike<ExecutionContext> | null {
  if (!alsInitialized) {
    alsInitialized = true
    try {
      // `process.getBuiltinModule` works in BOTH module systems (Node ≥ 20.16);
      // bare `require` only exists in CJS — under ESM loaders it throws and
      // would silently disable session propagation. Keep `require` as the
      // CJS fallback; non-Node environments degrade to null.
      const getBuiltinModule = (
        globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
      ).process?.getBuiltinModule
      const hooks = (getBuiltinModule?.('node:async_hooks') ??
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('node:async_hooks')) as typeof import('node:async_hooks')
      als = new hooks.AsyncLocalStorage<ExecutionContext>()
    } catch {
      als = null
    }
  }
  return als
}

export function runWithExecutionContext<R>(ctx: ExecutionContext, fn: () => R): R {
  const storage = getAls()
  if (storage) return storage.run(ctx, fn)
  return fn()
}

export function getExecutionContext(): ExecutionContext | undefined {
  return getAls()?.getStore()
}

export function withSession<T>(sessionId: string, fn: () => T): T {
  const existing = getExecutionContext()
  return runWithExecutionContext({ ...existing, sessionId }, fn)
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
