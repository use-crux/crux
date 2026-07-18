import type { EvalRunRecord } from "../types";

export interface EvalRunDiff {
  readonly fromRunId: string;
  readonly toRunId: string;
  readonly cells: readonly {
    readonly key: string;
    readonly status: { readonly from: string; readonly to: string };
    readonly durationMsDelta?: number;
    readonly scores: readonly {
      readonly name: string;
      readonly from: number | null;
      readonly to: number | null;
      readonly delta: number | null;
    }[];
  }[];
}

export function compareEvalRuns(
  from: EvalRunRecord,
  to: EvalRunRecord,
): EvalRunDiff {
  if (from.evalId !== to.evalId) {
    throw new TypeError("Choose two runs from the same Eval.");
  }
  const left = new Map(from.cells.map((cell) => [cellKey(cell), cell]));
  const right = new Map(to.cells.map((cell) => [cellKey(cell), cell]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return {
    fromRunId: from.runId,
    toRunId: to.runId,
    cells: keys.map((key) => {
      const leftCell = left.get(key);
      const rightCell = right.get(key);
      const leftScores = scoreValues(leftCell);
      const rightScores = scoreValues(rightCell);
      const scoreNames = [
        ...new Set([...leftScores.keys(), ...rightScores.keys()]),
      ].sort();
      const leftDuration = leftCell?.metrics?.durationMs;
      const rightDuration = rightCell?.metrics?.durationMs;
      return {
        key,
        status: {
          from: leftCell?.status ?? "missing",
          to: rightCell?.status ?? "missing",
        },
        ...(leftDuration !== undefined && rightDuration !== undefined
          ? { durationMsDelta: rightDuration - leftDuration }
          : {}),
        scores: scoreNames.map((name) => {
          const leftValue = leftScores.get(name) ?? null;
          const rightValue = rightScores.get(name) ?? null;
          return {
            name,
            from: leftValue,
            to: rightValue,
            delta:
              leftValue === null || rightValue === null
                ? null
                : rightValue - leftValue,
          };
        }),
      };
    }),
  };
}

function cellKey(cell: EvalRunRecord["cells"][number]): string {
  return `${cell.caseId}/${cell.variant}/trial-${(cell.trial ?? 0) + 1}`;
}

function scoreValues(
  cell: EvalRunRecord["cells"][number] | undefined,
): ReadonlyMap<string, number> {
  return new Map(
    (cell?.scores ?? [])
      .filter(
        (score): score is typeof score & { readonly value: number } =>
          (score.status === "computed" || score.status === "reused") &&
          typeof score.value === "number",
      )
      .map((score) => [score.name, score.value]),
  );
}
