/**
 * First-party context propagation SPI shared by Crux packages.
 *
 * This entrypoint is coordinated with first-party packages and is not a
 * supported application API. Domain facades own their public context types;
 * this module only gives each facade an isolated slot in Core's canonical
 * async-scope carrier.
 *
 * @internal
 * @module
 */

import { createFacet } from "./internal/carrier";

/** An isolated typed view over one value in the canonical async scope. */
export interface AsyncScopeFacet<T> {
  /** Return the value active for the current synchronous or asynchronous scope. */
  current(): T | undefined;
  /** Run a callback with this facet's value active. */
  run<R>(value: T, callback: () => R): R;
}

/**
 * Create one typed async-scope facet for a first-party Crux subsystem.
 *
 * @param debugName - Stable diagnostics-only name for the owning subsystem.
 * @internal
 */
export function createAsyncScopeFacet<T>(
  debugName: string,
): AsyncScopeFacet<T> {
  return createFacet<T>(debugName);
}
