/**
 * Portable async-context storage primitives.
 *
 * This module deliberately avoids static Node imports. Node hosts discover
 * `AsyncLocalStorage` through `process.getBuiltinModule`; edge hosts receive
 * `undefined` and must use an explicit context or synchronous fallback.
 *
 * @internal
 */

/** A segment-local ambient context capability supplied by a host or adapter. */
export interface CruxContextStorage<T> {
  get(): T | undefined
  run<R>(value: T, fn: () => R): R
}

type AsyncContextStorage<T> = {
  getStore(): T | undefined
  run<R>(value: T, fn: () => R): R
}

type ContextStorageConstructor = new <T>() => AsyncContextStorage<T>
type ContextStorageConstructorResolver = () => ContextStorageConstructor | undefined

interface ContextStorageResolver<T> {
  getStorage(): CruxContextStorage<T> | undefined
}

let constructorResolverForTesting: ContextStorageConstructorResolver | undefined
let resolvedConstructor: ContextStorageConstructor | undefined
let resolverInitialized = false
let resolverEpoch = 0

/** Create a typed storage handle backed by the shared portable resolver. */
export function createContextStorageResolver<T>(): ContextStorageResolver<T> {
  let storage: CruxContextStorage<T> | undefined
  let storageEpoch = -1

  return Object.freeze({
    getStorage() {
      if (storageEpoch !== resolverEpoch) {
        storageEpoch = resolverEpoch
        const Storage = resolveContextStorageConstructor()
        storage = Storage ? wrapAsyncContextStorage(new Storage<T>()) : undefined
      }
      return storage
    },
  })
}

/**
 * Run a synchronous fallback scope without claiming async propagation.
 *
 * When `asyncFailure` is supplied, promise-returning work is detached from the
 * fallback stack and the returned promise rejects immediately. This makes an
 * unsupported async host boundary fail closed rather than leak context.
 */
export function runWithSynchronousContext<T, R>(
  stack: T[],
  value: T,
  fn: () => R,
  asyncFailure?: () => Error,
): R {
  let active = true
  const remove = () => {
    if (!active) return
    active = false
    const index = stack.lastIndexOf(value)
    if (index >= 0) stack.splice(index, 1)
  }

  stack.push(value)
  try {
    const result = fn()
    if (asyncFailure && isPromiseLike(result)) {
      remove()
      void Promise.resolve(result).catch(() => undefined)
      return Promise.reject(asyncFailure()) as R
    }
    return result
  } finally {
    remove()
  }
}

/** @internal Override shared storage discovery for focused runtime tests. */
export function __setContextStorageResolverForTesting(
  resolver: ContextStorageConstructorResolver | undefined,
): void {
  constructorResolverForTesting = resolver
  resolvedConstructor = undefined
  resolverInitialized = false
  resolverEpoch += 1
}

function resolveContextStorageConstructor(): ContextStorageConstructor | undefined {
  if (!resolverInitialized) {
    resolverInitialized = true
    try {
      resolvedConstructor = (constructorResolverForTesting ?? resolveNodeAsyncLocalStorage)()
    } catch {
      resolvedConstructor = undefined
    }
  }
  return resolvedConstructor
}

function resolveNodeAsyncLocalStorage(): ContextStorageConstructor | undefined {
  const getBuiltinModule = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown }
    }
  ).process?.getBuiltinModule
  const hooks = getBuiltinModule?.('node:async_hooks') as
    | { AsyncLocalStorage?: ContextStorageConstructor }
    | undefined
  return typeof hooks?.AsyncLocalStorage === 'function' ? hooks.AsyncLocalStorage : undefined
}

function wrapAsyncContextStorage<T>(storage: AsyncContextStorage<T>): CruxContextStorage<T> {
  return Object.freeze({
    get: () => storage.getStore(),
    run: <R>(value: T, fn: () => R) => storage.run(value, fn),
  })
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}
