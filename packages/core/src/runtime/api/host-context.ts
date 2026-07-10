/**
 * Request-scoped host bindings for host-bound runtime declarations.
 *
 * Host packages use this module to make a configured declaration such as
 * `convex()` executable while a native request context is active. Core runtime
 * APIs call {@link createRuntimeWithHostContext}; direct `createRuntime()` still
 * rejects host-bound declarations so adapter boundaries stay explicit.
 *
 * @module
 */

import type { RuntimeStoreAdapter } from '../store'
import {
  __setContextStorageResolverForTesting,
  createContextStorageResolver,
  runWithSynchronousContext,
} from '../../shared/context-storage'
import type { CruxHostLifecycle } from './host-lifecycle'
export { remainingHostDeadlineMs } from './host-lifecycle'
import type { HostBoundRuntimeEngineDefinition } from './runtime-definition'
import {
  createRuntime,
  type CreateRuntimeOptions,
  type ResolvedRuntimeEngine,
} from './create-runtime'

/** Runtime options forwarded to an active host binding. */
export type RuntimeHostBindingOptions = Omit<CreateRuntimeOptions, 'runtime'>

/** Execute a host-bound runtime declaration with request-scoped host ports. */
export type RuntimeHostBinder = (
  definition: HostBoundRuntimeEngineDefinition,
  options: RuntimeHostBindingOptions,
) => ResolvedRuntimeEngine

/** Active host binding installed by a host package for one async request scope. */
export interface RuntimeHostContext extends CruxHostLifecycle {
  /** Host name from the runtime declaration, such as `convex`. */
  readonly host: string
  /** Bind the host declaration to executable ports for the current request. */
  readonly bind: RuntimeHostBinder
}

const contextStorage = createContextStorageResolver<readonly RuntimeHostContext[]>()
const fallbackStack: RuntimeHostContext[] = []

/**
 * Run work with a host-bound runtime binding active.
 *
 * Host integrations call this after they have native request context, component
 * refs, schedulers, and store bindings. Nested bindings are supported; the
 * innermost binding for the requested host wins.
 */
export function runWithRuntimeHost<R>(context: RuntimeHostContext, fn: () => R): R {
  const activeStorage = contextStorage.getStorage()
  if (activeStorage) {
    const stack = activeStorage.get() ?? []
    return activeStorage.run([...stack, context], fn)
  }

  return runWithSynchronousContext(fallbackStack, context, fn, fallbackAsyncRuntimeHostError)
}

/**
 * Resolve a runtime definition, using an active host binding when required.
 *
 * In-process definitions delegate directly to {@link createRuntime}. Host-bound
 * definitions first look for a matching request-scoped binding; if none exists,
 * they delegate to `createRuntime()` so callers keep the standard
 * `RUNTIME_HOST_ONLY` diagnostic.
 */
export function createRuntimeWithHostContext<TStore extends RuntimeStoreAdapter>(
  options: CreateRuntimeOptions<TStore>,
): ResolvedRuntimeEngine<TStore> {
  if (options.runtime.kind !== 'host-bound') return createRuntime(options)

  const context = activeContextForHost(options.runtime.host)
  if (!context) return createRuntime(options)

  const { runtime, ...runtimeOptions } = options
  void runtime
  return context.bind(options.runtime, runtimeOptions) as ResolvedRuntimeEngine<TStore>
}

function activeContextForHost(host: string): RuntimeHostContext | undefined {
  const activeStorage = contextStorage.getStorage()
  const stack = activeStorage ? activeStorage.get() ?? [] : fallbackStack
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const context = stack[index]
    if (context?.host === host) return context
  }
  return undefined
}

/** @internal Reset host-context storage resolution for focused fallback tests. */
export function setRuntimeHostAsyncLocalStorageResolverForTesting(
  resolver: (() =>
    | (new <T>() => {
        run<R>(store: T, fn: () => R): R
        getStore(): T | undefined
      })
    | undefined)
    | undefined,
): void {
  __setContextStorageResolverForTesting(resolver)
  fallbackStack.length = 0
}

function fallbackAsyncRuntimeHostError(): Error {
  return new Error(
    'Runtime host binding requires AsyncLocalStorage for async execution. The fallback host context is synchronous-only.',
  )
}
