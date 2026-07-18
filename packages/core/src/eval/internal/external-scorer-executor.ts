/** Execute only planner-admitted managed external-scorer actions. @internal */

import type { Score } from "./scorers/types";
import type { EvalExecutionPorts } from "./ports";
import {
  createScorerEvidenceEntry,
  createScorerEvidenceKey,
  readScorerEvidenceEntry,
} from "./scorer-evidence";
import type {
  EvalPlannedCell,
  EvalScoreEvidence,
  EvalScorerAction,
  EvalTaskExecutionEvidence,
} from "./types";

export async function executeExternalScorers(input: {
  readonly cell: EvalPlannedCell;
  readonly execution: EvalTaskExecutionEvidence;
  readonly ports: EvalExecutionPorts;
}): Promise<readonly EvalScoreEvidence[]> {
  const scores: EvalScoreEvidence[] = [];
  for (const action of input.cell.scorerActions) {
    scores.push(await executeAction(action, input));
  }
  return Object.freeze(scores);
}

async function executeAction(
  action: EvalScorerAction,
  input: Parameters<typeof executeExternalScorers>[0],
): Promise<EvalScoreEvidence> {
  if (action.kind === "reuse") {
    return computed(
      action.evidence.score,
      action,
      "reused",
      action.evidence.key,
    );
  }
  const key = resolveEvidenceKey(action, input);
  if (
    action.evidenceRead === "allow" &&
    key !== undefined &&
    input.ports.evidenceStore !== undefined
  ) {
    const hit = readScorerEvidenceEntry(
      await input.ports.evidenceStore.read(key),
      key,
    );
    if (hit !== undefined) return computed(hit.score, action, "reused", key);
  }
  if (input.ports.externalScorerHost === undefined) {
    return scorerError(
      action,
      `Managed external scorer '${action.scorerName}' has no ExternalScorerHost.`,
      "released",
    );
  }
  try {
    const result = await input.ports.externalScorerHost.execute({
      actionId: action.actionId,
      scorerName: action.scorerName,
      scorer: action.scorer,
      input: input.cell.input,
      output: input.execution.output,
      expected: input.cell.expected,
      task: input.cell.task,
      overrides: input.cell.overrides,
      ...(input.cell.call !== undefined ? { call: input.cell.call } : {}),
    });
    const score = result.score;
    if (
      score.name !== action.scorerName ||
      !isValidExternalMetrics(result) ||
      createScorerEvidenceEntry(
        "validation",
        score,
        input.ports.persistencePolicy,
      ) === undefined
    ) {
      return scorerError(
        action,
        `Managed external scorer '${action.scorerName}' returned an invalid score contract.`,
      );
    }
    const entry =
      key === undefined
        ? undefined
        : createScorerEvidenceEntry(key, score, input.ports.persistencePolicy);
    if (entry !== undefined && input.ports.evidenceStore !== undefined) {
      try {
        await input.ports.evidenceStore.write(entry);
      } catch {
        // Evidence writes are best effort; the score remains valid run evidence.
      }
    }
    return computed(score, action, "executed", key, result);
  } catch (error) {
    return scorerError(
      action,
      `Scorer '${action.scorerName}' threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isValidExternalMetrics(result: {
  readonly usage?: import("../../generation/types").TokenUsage;
  readonly actualUsd?: number;
}): boolean {
  if (
    result.actualUsd !== undefined &&
    (!Number.isFinite(result.actualUsd) || result.actualUsd < 0)
  ) {
    return false;
  }
  if (result.usage === undefined) return true;
  const usage = result.usage;
  return [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
    (value) => Number.isInteger(value) && value >= 0,
  );
}

function resolveEvidenceKey(
  action: Exclude<EvalScorerAction, { readonly kind: "reuse" }>,
  input: Parameters<typeof executeExternalScorers>[0],
): string | undefined {
  if (action.kind === "execute" && action.evidenceKey !== undefined) {
    return action.evidenceKey;
  }
  if (
    action.contractFingerprint === undefined ||
    action.hostContractFingerprint === undefined
  ) {
    return undefined;
  }
  return createScorerEvidenceKey({
    cell: input.cell,
    execution: input.execution,
    scorerName: action.scorerName,
    contractFingerprint: action.contractFingerprint,
    hostContractFingerprint: action.hostContractFingerprint,
    occurrence: action.occurrence,
    dependencies: action.dependencies,
  });
}

function computed(
  score: Readonly<Score>,
  action: EvalScorerAction,
  status: "executed" | "reused",
  evidenceRef?: string,
  metrics?: {
    readonly usage?: import("../../generation/types").TokenUsage;
    readonly actualUsd?: number;
  },
): EvalScoreEvidence {
  const common = {
    name: score.name,
    contractFingerprint: action.contractFingerprint ?? "identity_unavailable",
    value: score.score,
    ...(score.label !== undefined ? { label: score.label } : {}),
    ...(typeof score.metadata?.rationale === "string"
      ? { rationale: score.metadata.rationale }
      : {}),
  };
  return status === "reused"
    ? Object.freeze({
        status: "reused" as const,
        reason: "managed_external_reused" as const,
        ...common,
        work: Object.freeze({
          status: "reused" as const,
          reason: "exact_evidence" as const,
          ...(evidenceRef !== undefined ? { evidenceRef } : {}),
          reservation: "released" as const,
        }),
      })
    : Object.freeze({
        status: "computed" as const,
        reason: "managed_external_executed" as const,
        ...common,
        work: Object.freeze({
          status: "executed" as const,
          reason:
            action.evidenceRead === "bypass"
              ? (action.evidenceReadReason ?? "fresh_requested")
              : action.kind === "execute"
                ? action.reason
                : ("no_exact_evidence" as const),
          ...(evidenceRef !== undefined ? { evidenceRef } : {}),
          reservation: "consumed" as const,
        }),
        ...(metrics !== undefined &&
        (metrics.actualUsd !== undefined || metrics.usage !== undefined)
          ? {
              metrics: Object.freeze({
                ...(metrics.actualUsd !== undefined
                  ? { actualUsd: metrics.actualUsd }
                  : {}),
                ...(metrics.usage !== undefined
                  ? { usage: metrics.usage }
                  : {}),
              }),
            }
          : {}),
      });
}

function scorerError(
  action: EvalScorerAction,
  message: string,
  reservation: "consumed" | "released" = "consumed",
): EvalScoreEvidence {
  return Object.freeze({
    status: "errored",
    reason: "scorer_error",
    name: action.scorerName,
    contractFingerprint: action.contractFingerprint ?? "identity_unavailable",
    message,
    work: Object.freeze({
      status: reservation === "consumed" ? "errored" : "not_called",
      reason: "scorer_error",
      reservation,
    }),
  });
}
