import type {
  CruxStore,
  JsonObject,
  ListOptions,
  ListResult,
  ScoredEntry,
  SetOptions,
  StoreEvent,
  VectorSearchOptions,
  VectorSearchQuery,
} from '@crux/core/store'
import { getRuntime } from '@crux/core'

export interface ConvexRuntimeTarget {
  threadId?: string
  userId?: string | null
  toolCallId?: string
  [key: string]: unknown
}

export interface ConvexMemoryNamespaceArgs {
  input: Record<string, unknown>
  promptId?: string
  target?: ConvexRuntimeTarget
}

export type ConvexMemoryNamespace = string | ((args: ConvexMemoryNamespaceArgs) => string | Promise<string>)

export interface ConvexCruxRuntime<TCtx = unknown, TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget> {
  ctx: TCtx
  store: CruxStore
  target?: TTarget
  component?: unknown
  namespace?: ConvexMemoryNamespace
}

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>

type AsyncHooksModule = {
  AsyncLocalStorage?: AsyncLocalStorageConstructor
}

type GlobalAsyncHooks = typeof globalThis & {
  AsyncLocalStorage?: AsyncLocalStorageConstructor
}

let storage: AsyncLocalStorageLike<ConvexCruxRuntime> | null = null
let storageInitialized = false
const runtimeStack: ConvexCruxRuntime[] = []
let activeFallbackAsyncRuntime: ConvexCruxRuntime | undefined

function getStorage(): AsyncLocalStorageLike<ConvexCruxRuntime> | null {
  if (!storageInitialized) {
    storageInitialized = true
    const AsyncLocalStorage = resolveAsyncLocalStorage()
    storage = AsyncLocalStorage ? new AsyncLocalStorage<ConvexCruxRuntime>() : null
  }
  return storage
}

function resolveAsyncLocalStorage(): AsyncLocalStorageConstructor | undefined {
  const globalAsyncLocalStorage = (globalThis as GlobalAsyncHooks).AsyncLocalStorage
  if (typeof globalAsyncLocalStorage === 'function') {
    return globalAsyncLocalStorage
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const hooks = require('node:async_hooks') as AsyncHooksModule
    return typeof hooks.AsyncLocalStorage === 'function' ? hooks.AsyncLocalStorage : undefined
  } catch {
    return undefined
  }
}

export function runWithConvexCruxRuntime<R, TCtx, TTarget extends ConvexRuntimeTarget>(
  runtime: ConvexCruxRuntime<TCtx, TTarget>,
  fn: () => R,
): R {
  const activeStorage = getStorage()
  if (activeStorage) return activeStorage.run(runtime, fn)
  if (activeFallbackAsyncRuntime && activeFallbackAsyncRuntime !== runtime) {
    throw new Error(
      'Convex Crux runtime requires AsyncLocalStorage for concurrent async execution. Convex supports AsyncLocalStorage; if this error appears in Convex, check the runtime bundle for the async_hooks shim.',
    )
  }
  runtimeStack.push(runtime)
  try {
    const result = fn()
    if (isPromiseLike(result)) {
      activeFallbackAsyncRuntime = runtime
      return result.finally(() => {
        if (activeFallbackAsyncRuntime === runtime) {
          activeFallbackAsyncRuntime = undefined
        }
        popRuntime(runtime)
      }) as R
    }
    popRuntime(runtime)
    return result
  } catch (error) {
    popRuntime(runtime)
    throw error
  }
}

export function getConvexCruxRuntime(): ConvexCruxRuntime | undefined {
  return getStorage()?.getStore() ?? runtimeStack[runtimeStack.length - 1]
}

function isPromiseLike<T>(
  value: T | PromiseLike<T>,
): value is PromiseLike<T> & { finally: (onFinally: () => void) => Promise<T> } {
  return !!value && typeof value === 'object' && 'then' in value && 'finally' in value
}

function popRuntime(runtime: ConvexCruxRuntime): void {
  const index = runtimeStack.lastIndexOf(runtime)
  if (index >= 0) {
    runtimeStack.splice(index, 1)
  }
}

function resolveRuntimeStore(): CruxStore {
  const store = getConvexCruxRuntime()?.store ?? getRuntime().store
  if (!store) {
    throw new Error(
      'No Convex Crux runtime store is active. Use createCruxConvex(...).run(), convexAgent(), or pass an explicit memory store.',
    )
  }
  return store
}

export const convexRuntimeStore: CruxStore = {
  get(key: string): Promise<JsonObject | null> {
    return resolveRuntimeStore().get(key)
  },
  set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
    return resolveRuntimeStore().set(key, value, options)
  },
  delete(key: string): Promise<void> {
    return resolveRuntimeStore().delete(key)
  },
  list(prefix: string, options?: ListOptions): Promise<ListResult> {
    return resolveRuntimeStore().list(prefix, options)
  },
  subscribe(callback: (event: StoreEvent) => void): () => void {
    return resolveRuntimeStore().subscribe?.(callback) ?? (() => undefined)
  },
  supportsTtl(): boolean {
    return resolveRuntimeStore().supportsTtl?.() ?? false
  },
  capabilities() {
    return resolveRuntimeStore().capabilities?.() ?? {}
  },
  vectorSearch(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> {
    const vectorSearch = resolveRuntimeStore().vectorSearch
    if (!vectorSearch) return Promise.resolve([])
    return vectorSearch(embedding, options)
  },
  searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
    const searchVectors = resolveRuntimeStore().searchVectors
    if (!searchVectors) return Promise.resolve([])
    return searchVectors(query)
  },
}

export async function resolveConvexMemoryNamespace(args: {
  input: Record<string, unknown>
  promptId?: string
}): Promise<string> {
  const runtime = getConvexCruxRuntime()
  const configured = runtime?.namespace
  if (typeof configured === 'string') return configured
  if (typeof configured === 'function') {
    return await configured({ input: args.input, promptId: args.promptId, target: runtime?.target })
  }
  const target = runtime?.target
  if (target?.threadId) return `thread:${target.threadId}`
  if (target?.userId) return `user:${target.userId}`
  return 'default'
}
