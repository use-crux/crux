/** Portable placement decision made after exact task evidence lookup. @internal */

import type { EvalHostReadinessProvider } from "./ports";
import type {
  EvalHostReadiness,
  EvalPlannedCell,
  EvalRequiredHostWork,
} from "./types";

export async function resolveEvalHostReadiness(input: {
  readonly cells: readonly EvalPlannedCell[];
  readonly offline: boolean;
  readonly provider?: EvalHostReadinessProvider;
}): Promise<EvalHostReadiness> {
  const work = requiredHostWork(input.cells);
  if (work.length === 0) {
    return Object.freeze({
      status: "local" as const,
      reason: input.cells.some(
        (cell) =>
          cell.action.kind === "reuse" &&
          cell.requiredHostCapabilities.length > 0,
      )
        ? ("exact_evidence" as const)
        : ("no_required_host_work" as const),
    });
  }
  if (input.offline) {
    return Object.freeze({
      status: "unverified" as const,
      reason: "offline" as const,
      remedies: Object.freeze([]),
    });
  }
  if (!input.provider) {
    return Object.freeze({
      status: "unverified" as const,
      reason: "connection_unavailable" as const,
      remedies: Object.freeze([
        "Set CRUX_EVAL_HOST_URL.",
        "Set CRUX_EVAL_HOST_DEPLOYMENT_ID.",
        "Set CRUX_EVAL_HOST_TOKEN.",
      ]),
    });
  }
  return await input.provider.resolve(Object.freeze(work));
}

function requiredHostWork(
  cells: readonly EvalPlannedCell[],
): EvalRequiredHostWork[] {
  return cells.flatMap((cell) => {
    if (cell.action.kind !== "execute") return [];
    const capabilities = cell.requiredHostCapabilities;
    return capabilities.length === 0
      ? []
      : [
          Object.freeze({
            caseId: cell.caseId,
            variant: cell.variant,
            trial: cell.trial,
            capabilities,
          }),
        ];
  });
}
