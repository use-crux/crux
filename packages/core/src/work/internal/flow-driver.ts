/**
 * First-party Flow execution for the internal Work kernel.
 *
 * @internal
 * @module
 */

import type { FlowHandle } from "../../flow/handle-types";
import type { FlowSignalMap } from "../../flow/signals";
import type { InternalWorkTargetDriver } from "./target-driver";

type FlowWorkInputArgs<TInput> = [TInput] extends [void]
  ? [] | [input: TInput]
  : [input: TInput];

/**
 * Bind one typed Flow invocation to the provider-neutral Work driver seam.
 *
 * @remarks The driver uses the Flow handle's existing execution authority and
 * returns only completed business output. It does not expose a public target
 * protocol or infer execution authority for other target kinds.
 *
 * @param target - Frozen first-party Flow definition to execute once.
 * @param args - Inferred Flow input, omitted for inputless Flows.
 * @returns An internal driver retaining the Flow's exact output type.
 *
 * @internal
 */
export function createFlowWorkDriver<
  TOutput,
  TInput,
  TSignals extends FlowSignalMap | undefined,
>(
  target: FlowHandle<TOutput, TInput, TSignals>,
  ...args: FlowWorkInputArgs<TInput>
): InternalWorkTargetDriver<TOutput> {
  return Object.freeze({
    async run() {
      const result = await target.run(
        ...(args as Parameters<FlowHandle<TOutput, TInput, TSignals>["run"]>),
      );
      if (result.status !== "completed") {
        throw new TypeError(
          `Flow \`${target.name}\` reached \`${result.status}\` before Work completion.`,
        );
      }
      return result.output;
    },
  });
}
