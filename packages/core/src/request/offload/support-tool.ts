/**
 * Bounded provider-neutral exact-recovery retrieval capability.
 *
 * @module
 */

import { z } from "zod";
import type { AnyToolSet } from "../../types";
import { readOffloadValue } from "./publish";

/** Reserved provider-visible name of the exact-recovery support capability. */
export const OFFLOAD_SUPPORT_TOOL_NAME = "__crux_ReadOffload";

const supportTool = Object.freeze({
  description:
    "Retrieve one exact value using an opaque handle included in the request.",
  parameters: z.object({
    handle: z.string().min(1),
  }),
  async execute(input: { readonly handle: string }) {
    return readOffloadValue(input.handle);
  },
});

/** Return the one Crux-owned support Tool required by offload rungs. @internal */
export function offloadSupportTools(): AnyToolSet {
  return { [OFFLOAD_SUPPORT_TOOL_NAME]: supportTool };
}

/** Return whether a Tool registry contains an exact-recovery output policy. @internal */
export function hasOffloadOutputPolicy(tools: AnyToolSet): boolean {
  return Object.values(tools).some((value) => {
    if (!value || typeof value !== "object") return false;
    return (
      (value as { readonly output?: { readonly _tag?: unknown } }).output
        ?._tag === "offload-output"
    );
  });
}
