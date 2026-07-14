import type { AsyncScopeFacet } from "..";

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
};

type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>;

interface AsyncHooksModule {
  readonly AsyncLocalStorage?: AsyncLocalStorageConstructor;
}

interface AsyncScopeFrame {
  readonly parent?: AsyncScopeFrame;
  readonly key: symbol;
  readonly value: unknown;
}

type GlobalAsyncHooks = typeof globalThis & {
  readonly AsyncLocalStorage?: AsyncLocalStorageConstructor;
};

type AsyncLocalStorageResolver = () => AsyncLocalStorageConstructor | undefined;

let storage: AsyncLocalStorageLike<AsyncScopeFrame> | null = null;
let storageInitialized = false;
let synchronousFrame: AsyncScopeFrame | undefined;
let configuredResolver: AsyncLocalStorageResolver | undefined;
const capturedFrames = new WeakMap<object, AsyncScopeFrame | undefined>();
const registeredFacets = new Set<string>();

/** Opaque handle for one immutable carrier frame. */
export interface CapturedAsyncScope {
  readonly kind: "captured.async-scope";
}

/** Create an opaque typed view over one private carrier slot. */
export function createFacet<T>(debugName: string): AsyncScopeFacet<T> {
  const key = Symbol(debugName);
  registeredFacets.add(debugName);

  return Object.freeze({
    current(): T | undefined {
      return valueFor<T>(key);
    },
    run<R>(value: T, callback: () => R): R {
      return runWithFrame({ parent: currentFrame(), key, value }, callback);
    },
  });
}

/** Return stable diagnostics names for every facet created in this module graph. @internal */
export function registeredAsyncScopeFacetsForTesting(): readonly string[] {
  return [...registeredFacets].sort();
}

function valueFor<T>(key: symbol): T | undefined {
  let frame = currentFrame();
  while (frame) {
    if (frame.key === key) return frame.value as T;
    frame = frame.parent;
  }
  return undefined;
}

function currentFrame(): AsyncScopeFrame | undefined {
  return getStorage()?.getStore() ?? synchronousFrame;
}

function runWithFrame<R>(frame: AsyncScopeFrame, callback: () => R): R {
  const activeStorage = getStorage();
  if (activeStorage) return activeStorage.run(frame, callback);

  const previousFrame = synchronousFrame;
  synchronousFrame = frame;
  try {
    return callback();
  } finally {
    synchronousFrame = previousFrame;
  }
}

function getStorage(): AsyncLocalStorageLike<AsyncScopeFrame> | null {
  if (storageInitialized) return storage;

  storageInitialized = true;
  try {
    const AsyncLocalStorage = (
      configuredResolver ?? resolveAsyncLocalStorage
    )();
    storage = AsyncLocalStorage
      ? new AsyncLocalStorage<AsyncScopeFrame>()
      : null;
  } catch {
    storage = null;
  }
  return storage;
}

/** Return whether the canonical carrier has an asynchronous propagation port. */
export function asyncScopeStorageAvailable(): boolean {
  return getStorage() !== null;
}

/** Return whether any Crux facet is active in the current carrier frame. */
export function asyncScopeActive(): boolean {
  return currentFrame() !== undefined;
}

/** Capture the current immutable frame without exposing its slots or keys. */
export function captureAsyncScope(): CapturedAsyncScope {
  const captured = Object.freeze({
    kind: "captured.async-scope" as const,
  });
  capturedFrames.set(captured, currentFrame());
  return captured;
}

/** Restore a previously captured frame for one callback. */
export function runWithCapturedAsyncScope<R>(
  captured: CapturedAsyncScope,
  callback: () => R,
): R {
  const frame = capturedFrames.get(captured);
  if (!frame) return callback();
  return runWithFrame(frame, callback);
}

function resolveAsyncLocalStorage(): AsyncLocalStorageConstructor | undefined {
  const globalAsyncLocalStorage = (globalThis as GlobalAsyncHooks)
    .AsyncLocalStorage;
  if (typeof globalAsyncLocalStorage === "function")
    return globalAsyncLocalStorage;

  try {
    const getBuiltinModule = (
      globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
    ).process?.getBuiltinModule;
    const hooks = (getBuiltinModule?.("node:async_hooks") ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("node:async_hooks")) as AsyncHooksModule;
    return typeof hooks.AsyncLocalStorage === "function"
      ? hooks.AsyncLocalStorage
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Override storage resolution before first use.
 *
 * This hook is intentionally absent from the published first-party SPI. It is
 * used by focused carrier/facade tests and may be called repeatedly only with
 * the same resolver. Passing `undefined` resets isolated test state.
 *
 * @internal
 */
export function setAsyncScopeResolverForTesting(
  resolver: AsyncLocalStorageResolver | undefined,
): void {
  configuredResolver = resolver;
  storage = null;
  storageInitialized = false;
  synchronousFrame = undefined;
}
