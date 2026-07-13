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

import type { RuntimeStoreAdapter } from "../store";
import type { CruxHostLifecycle } from "./host-lifecycle";
export { remainingHostDeadlineMs } from "./host-lifecycle";
import { createAsyncScopeFacet } from "../../async-scope";
import {
  asyncScopeStorageAvailable,
  setAsyncScopeResolverForTesting,
} from "../../async-scope/internal/carrier";
import type { HostBoundRuntimeEngineDefinition } from "./runtime-definition";
import {
  createRuntime,
  type CreateRuntimeOptions,
  type ResolvedRuntimeEngine,
} from "./create-runtime";

/** Runtime options forwarded to an active host binding. */
export type RuntimeHostBindingOptions = Omit<CreateRuntimeOptions, "runtime">;

/** Execute a host-bound runtime declaration with request-scoped host ports. */
export type RuntimeHostBinder = (
  definition: HostBoundRuntimeEngineDefinition,
  options: RuntimeHostBindingOptions,
) => ResolvedRuntimeEngine;

/** Active host binding installed by a host package for one async request scope. */
export interface RuntimeHostContext extends CruxHostLifecycle {
  /** Host name from the runtime declaration, such as `convex`. */
  readonly host: string;
  /** Bind the host declaration to executable ports for the current request. */
  readonly bind: RuntimeHostBinder;
}

const runtimeHostScope =
  createAsyncScopeFacet<readonly RuntimeHostContext[]>("core.runtime-host");

/**
 * Run work with a host-bound runtime binding active.
 *
 * Host integrations call this after they have native request context, component
 * refs, schedulers, and store bindings. Nested bindings are supported; the
 * innermost binding for the requested host wins.
 */
export function runWithRuntimeHost<R>(
  context: RuntimeHostContext,
  fn: () => R,
): R {
  const stack = runtimeHostScope.current() ?? [];
  const supportsAsyncPropagation = asyncScopeStorageAvailable();
  return runtimeHostScope.run([...stack, context], () => {
    const result = fn();
    if (!supportsAsyncPropagation && isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => undefined);
      return Promise.reject(fallbackAsyncRuntimeHostError()) as R;
    }
    return result;
  });
}

/**
 * Resolve a runtime definition, using an active host binding when required.
 *
 * In-process definitions delegate directly to {@link createRuntime}. Host-bound
 * definitions first look for a matching request-scoped binding; if none exists,
 * they delegate to `createRuntime()` so callers keep the standard
 * `RUNTIME_HOST_ONLY` diagnostic.
 */
export function createRuntimeWithHostContext<
  TStore extends RuntimeStoreAdapter,
>(options: CreateRuntimeOptions<TStore>): ResolvedRuntimeEngine<TStore> {
  if (options.runtime.kind !== "host-bound") return createRuntime(options);

  const context = activeContextForHost(options.runtime.host);
  if (!context) return createRuntime(options);

  const { runtime, ...runtimeOptions } = options;
  void runtime;
  return context.bind(
    options.runtime,
    runtimeOptions,
  ) as ResolvedRuntimeEngine<TStore>;
}

function activeContextForHost(host: string): RuntimeHostContext | undefined {
  const stack = runtimeHostScope.current() ?? [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const context = stack[index];
    if (context?.host === host) return context;
  }
  return undefined;
}

/** @internal Reset host-context storage resolution for focused fallback tests. */
export function setRuntimeHostAsyncLocalStorageResolverForTesting(
  resolver:
    | (() =>
        | (new <T>() => {
            run<R>(store: T, fn: () => R): R;
            getStore(): T | undefined;
          })
        | undefined)
    | undefined,
): void {
  setAsyncScopeResolverForTesting(resolver);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return !!value && typeof value === "object" && "then" in value;
}

function fallbackAsyncRuntimeHostError(): Error {
  return new Error(
    "Runtime host binding requires AsyncLocalStorage for async execution. The fallback host context is synchronous-only.",
  );
}
