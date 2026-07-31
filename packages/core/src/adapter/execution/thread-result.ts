/**
 * Thread receipt augmentation for managed execution results.
 *
 * Result envelopes can carry non-enumerable symbols used by later acceptance
 * stages, so adding the public receipt must preserve property descriptors.
 *
 * @internal
 * @module
 */

import type { ThreadCommit } from "../../thread/types";

/** Add a public receipt without losing private non-enumerable result carriers. */
export function attachThreadCommit<TResult extends object>(
  result: TResult,
  threadCommit: ThreadCommit,
): TResult & { readonly threadCommit: ThreadCommit } {
  const attached = Object.create(Object.getPrototypeOf(result)) as TResult;
  Object.defineProperties(attached, Object.getOwnPropertyDescriptors(result));
  Object.defineProperty(attached, "threadCommit", {
    configurable: true,
    enumerable: true,
    writable: false,
    value: threadCommit,
  });
  return attached as TResult & { readonly threadCommit: ThreadCommit };
}
