import type { EvalRunRecord } from "../types";

/** Runs that can be compared without crossing Eval definitions. */
export function comparableEvalRuns(
  selected: EvalRunRecord,
  runs: readonly EvalRunRecord[],
): EvalRunRecord[] {
  return runs.filter(
    (candidate) =>
      candidate.evalId === selected.evalId &&
      candidate.runId !== selected.runId,
  );
}

/** Keep Baseline promotion scoped to an arm declared by the selected run. */
export function baselineArmForRun(
  run: EvalRunRecord,
  requested: string,
): string {
  const arms = run.variants?.map((variant) => variant.name) ?? ["current"];
  return arms.includes(requested) ? requested : (arms[0] ?? "current");
}
