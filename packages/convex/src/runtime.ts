import type {
  JsonObject,
  RecordEvent,
  RecordListOptions,
  RecordPage,
  RecordStore,
  RecordWriteOptions,
  Storage,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
  VectorStoreCapabilities,
} from '@use-crux/core/storage'
import { getHooks } from '@use-crux/core'

export { CONVEX_RUNTIME_ENTRY, convex } from './runtime-engine/definition'
export type { ConvexRuntimeEngineDefinition, ConvexRuntimeEngineOptions } from './runtime-engine/definition'
export { createConvexRuntimeHandlers } from './runtime-engine/handlers'
export type { ConvexRuntimeHandlers, CreateConvexRuntimeHandlersOptions } from './runtime-engine/handlers'
export { convexRuntimeStore } from './runtime-engine/store'
export type { ConvexRuntimeComponent, ConvexRuntimeStoreOptions } from './runtime-engine/store'

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
  storage: Storage
  records: RecordStore
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

function resolveRuntimeStorage(): Storage {
  const runtimeStorage = getConvexCruxRuntime()?.storage
  if (runtimeStorage) return runtimeStorage
  const runtimeRecords = getHooks().records
  if (!runtimeRecords) {
    throw new Error(
      'No Convex Crux runtime storage is active. Use createCruxConvex(...).run(), convexAgent(), or pass explicit storage.',
    )
  }
  return { records: runtimeRecords }
}

function resolveRuntimeRecords(): RecordStore {
  return getConvexCruxRuntime()?.records ?? resolveRuntimeStorage().records
}

export const convexRuntimeRecords: RecordStore = {
  _tag: 'RecordStore',
  get(key: string): Promise<JsonObject | null> {
    return resolveRuntimeRecords().get(key)
  },
  put(key: string, value: JsonObject, options?: RecordWriteOptions): Promise<void> {
    return resolveRuntimeRecords().put(key, value, options)
  },
  create(key: string, value: JsonObject, options?: RecordWriteOptions): Promise<boolean> {
    return resolveRuntimeRecords().create(key, value, options)
  },
  delete(key: string): Promise<void> {
    return resolveRuntimeRecords().delete(key)
  },
  list(prefix: string, options?: RecordListOptions): Promise<RecordPage> {
    return resolveRuntimeRecords().list(prefix, options)
  },
  watch(prefix: string, callback: (event: RecordEvent) => void) {
    return resolveRuntimeRecords().watch?.(prefix, callback) ?? (() => undefined)
  },
  capabilities() {
    return resolveRuntimeRecords().capabilities()
  },
}

function resolveRuntimeVectors(): VectorStore {
  const vectors = resolveRuntimeStorage().vectors
  if (!vectors) {
    throw new Error('No Convex Crux runtime vector storage is active. Pass storage.vectors or use convexStorage().')
  }
  return vectors
}

export const convexRuntimeVectors: VectorStore = {
  _tag: 'VectorStore',
  upsert(records: readonly VectorRecord[]): Promise<void> {
    return resolveRuntimeVectors().upsert(records)
  },
  delete(keys: readonly string[]): Promise<void> {
    return resolveRuntimeVectors().delete(keys)
  },
  search(query: VectorSearchQuery): Promise<readonly VectorHit[]> {
    return resolveRuntimeVectors().search(query)
  },
  capabilities(): VectorStoreCapabilities {
    return resolveRuntimeVectors().capabilities()
  },
}

export const convexRuntimeStorage: Storage = {
  records: convexRuntimeRecords,
  vectors: convexRuntimeVectors,
  get blobs() {
    return resolveRuntimeStorage().blobs
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
