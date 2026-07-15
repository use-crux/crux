/** Zero-config assertion Gate projection for one Current cell. @internal */

import type { EvalCell, EvalGateSummary } from "./types";

export function evaluateCurrentGates(cell: EvalCell): EvalGateSummary {
  const passed = cell.status === "passed";
  return Object.freeze({
    passed,
    blockingPassed: passed,
    results: Object.freeze([] as const),
  });
}
