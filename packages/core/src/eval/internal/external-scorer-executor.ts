/** Execute only planner-admitted managed external-scorer actions. @internal */

import type { Score } from "../../quality/scorers";
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
    const score = await input.ports.externalScorerHost.execute({
      actionId: action.actionId,
      scorerName: action.scorerName,
      scorer: action.scorer,
      input: input.cell.input,
      output: input.execution.output,
      expected: input.cell.expected,
    });
    if (
      score.name !== action.scorerName ||
      createScorerEvidenceEntry("validation", score) === undefined
    ) {
      return scorerError(
        action,
        `Managed external scorer '${action.scorerName}' returned an invalid score contract.`,
      );
    }
    const entry =
      key === undefined ? undefined : createScorerEvidenceEntry(key, score);
    if (entry !== undefined && input.ports.evidenceStore !== undefined) {
      try {
        await input.ports.evidenceStore.write(entry);
      } catch {
        // Evidence writes are best effort; the score remains valid run evidence.
      }
    }
    return computed(score, action, "executed", key);
  } catch (error) {
    return scorerError(
      action,
      `Scorer '${action.scorerName}' threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
  });
}

function computed(
  score: Readonly<Score>,
  action: EvalScorerAction,
  status: "executed" | "reused",
  evidenceRef?: string,
): EvalScoreEvidence {
  return Object.freeze({
    status: "computed" as const,
    reason:
      status === "reused"
        ? ("managed_external_reused" as const)
        : ("managed_external_executed" as const),
    name: score.name,
    contractFingerprint: action.contractFingerprint ?? "identity_unavailable",
    value: score.score,
    ...(score.label !== undefined ? { label: score.label } : {}),
    ...(typeof score.metadata?.rationale === "string"
      ? { rationale: score.metadata.rationale }
      : {}),
    work: Object.freeze({
      status,
      reason:
        status === "reused"
          ? ("exact_evidence" as const)
          : action.evidenceRead === "bypass"
            ? (action.evidenceReadReason ?? "fresh_requested")
            : action.kind === "execute"
              ? action.reason
              : ("no_exact_evidence" as const),
      ...(evidenceRef !== undefined ? { evidenceRef } : {}),
      reservation: status === "reused" ? "released" : "consumed",
    }),
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
