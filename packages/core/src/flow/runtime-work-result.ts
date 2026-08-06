/** Persist application Flow Work results through the existing Runtime port. */

import { createRuntimeError } from "../runtime/engine/errors";
import type { RuntimeResultRef } from "../runtime/results/types";
import type { RuntimeFlowExecution } from "./runtime-engine";
import { flowOutputForPersistence } from "./serialization";

/** Store the required terminal result before its fenced Work commit. @internal */
export async function persistRuntimeFlowWorkResult(
  execution: RuntimeFlowExecution,
  output: unknown,
): Promise<RuntimeResultRef | undefined> {
  if (execution.snapshot.resultObligation?.kind !== "required") {
    return undefined;
  }
  const results = execution.runtime.store.results;
  if (!results) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed: `Flow Work \`${execution.work.workId}\` cannot publish its required result.`,
      why: "The configured Runtime store has no durable result payload port.",
      whatStillWorks:
        "Foreground flow.run() and Runtime work without a result obligation remain available.",
      nextStep:
        "Configure a Runtime store that implements canonical result payload storage.",
    });
  }
  return await results.put(flowOutputForPersistence(output, "flow result"), {
    namespace: execution.work.namespace,
  });
}
