import type { EvalRun } from "@use-crux/core/eval/internal/runner";

const CLI_MESSAGE_LIMIT = 4_096;

/** Keep the NDJSON CLI protocol diagnostic-only; full runs are already stored. */
export function projectEvalRunForCli(run: EvalRun): unknown {
  return {
    runId: run.runId,
    status: run.status,
    passed: run.passed,
    cost: projectOptionalNumber(run.cost.actualUsd, "actualUsd"),
    cells: run.cells.map((cell) => ({
      caseId: cell.caseId,
      variant: cell.variant,
      trial: cell.trial,
      status: cell.status,
      task: { status: cell.task.status, reason: cell.task.reason },
      scores: cell.scores.map((score) => ({
        status: score.status,
        reason: score.reason,
        name: score.name,
        ...(score.status !== "errored" && score.status !== "missing"
          ? {
              value: score.value,
              ...(score.label === undefined ? {} : { label: score.label }),
            }
          : { message: truncateCliMessage(score.message) }),
        ...("work" in score
          ? {
              work: {
                status: score.work.status,
                reason: score.work.reason,
                ...("evidenceRef" in score.work &&
                score.work.evidenceRef !== undefined
                  ? { evidenceRef: score.work.evidenceRef }
                  : {}),
                reservation: score.work.reservation,
              },
            }
          : {}),
      })),
      assertions: {
        ran: cell.assertions.ran,
        notEvaluated: cell.assertions.notEvaluated,
        outcomes: cell.assertions.outcomes.map((outcome) => ({
          status: outcome.status,
          ...(outcome.message === undefined
            ? {}
            : { message: truncateCliMessage(outcome.message) }),
        })),
      },
      metrics: {
        durationMs: cell.metrics.durationMs,
        ...projectOptionalNumber(cell.metrics.costUsd, "costUsd"),
      },
      runIds: cell.runIds,
      ...(cell.error === undefined
        ? {}
        : {
            error: {
              phase: cell.error.phase,
              message: truncateCliMessage(cell.error.message),
            },
          }),
    })),
  };
}

function projectOptionalNumber<Key extends string>(
  value: number | undefined,
  key: Key,
): Partial<Record<Key, number>> {
  return value === undefined ? {} : { [key]: value } as Record<Key, number>;
}

function truncateCliMessage(value: string): string {
  return value.length <= CLI_MESSAGE_LIMIT
    ? value
    : `${value.slice(0, CLI_MESSAGE_LIMIT)}…[truncated]`;
}
