/**
 * Optional authoritative provider token-counting boundary.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";

/** Bound authoritative counter for one adapter client. @internal */
export type RequestTokenCounter<
  TExtra extends Record<string, unknown>,
> = (args: CallArgs<TExtra>) => Promise<number>;

/** Validate an authoritative provider count before it affects planning. @internal */
export function assertAuthoritativeTokenCount(count: number): number {
  if (Number.isSafeInteger(count) && count >= 0) return count;
  throw new TypeError(
    "Adapter countTokens() must return a non-negative safe integer.",
  );
}
