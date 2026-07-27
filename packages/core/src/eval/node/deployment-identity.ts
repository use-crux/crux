/** Canonical deployed identity projections for one hydrated Eval. @internal */

import { fingerprintDeployedEvalCase } from "../../runtime/eval-registry/projection";
import type { HydratedEval } from "./cases";

/** Project the exact deployed Case manifest expected by host readiness. */
export function projectHydratedEvalCaseFingerprints(
  entry: HydratedEval,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      entry.cases.map((item) => [
        item.id,
        fingerprintDeployedEvalCase(entry.eval, item.id, item.authored),
      ]),
    ),
  );
}
