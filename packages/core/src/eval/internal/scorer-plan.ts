/** Planning helpers for explicit managed external-scorer actions. @internal */

import { boundScorerLib, type Scorer } from "../../quality/scorers";
import {
  SCORER_IDENTITY,
  type MaybeIdentifiedScorer,
} from "../../quality/internal/scorer-runtime";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import type { EvalEvidenceStore } from "./ports";
import {
  createScorerEvidenceKey,
  readScorerEvidenceEntry,
} from "./scorer-evidence";
import type {
  EvalPlanAction,
  EvalPlannedCell,
  EvalScorerAction,
} from "./types";

export function resolveEvalScorers(
  raw: unknown,
): readonly Scorer<unknown, unknown, unknown>[] {
  const resolved =
    typeof raw === "function"
      ? raw(boundScorerLib<unknown, unknown, unknown>())
      : raw;
  if (
    !Array.isArray(resolved) ||
    resolved.some((scorer) => typeof scorer !== "function")
  ) {
    throw new TypeError(
      "Eval scorers must be functions or a factory returning scorer functions.",
    );
  }
  return resolved as readonly Scorer<unknown, unknown, unknown>[];
}

export async function planExternalScorers(input: {
  readonly rawScorers: unknown;
  readonly cell: EvalPlannedCell;
  readonly taskAction: EvalPlanAction;
  readonly evidenceStore?: EvalEvidenceStore;
  readonly hostContractFingerprint?: string;
}): Promise<readonly EvalScorerAction[]> {
  const external = resolveEvalScorers(input.rawScorers).filter(
    (scorer) => scorer.costClass === "model",
  );
  return Object.freeze(
    await Promise.all(
      external.map((scorer, index) => planExternalScorer(scorer, index, input)),
    ),
  );
}

async function planExternalScorer(
  scorer: Scorer<unknown, unknown, unknown>,
  index: number,
  input: Parameters<typeof planExternalScorers>[0],
): Promise<EvalScorerAction> {
  const scorerName = scorer.scorerName ?? scorer.name ?? "(dynamic)";
  const actionId = `score:${index}:${scorerName}`;
  const contractFingerprint = projectScorerContract(scorer);
  const common = {
    actionId,
    dependency: "task:root" as const,
    scorerName,
    scorer,
    ...(contractFingerprint !== undefined ? { contractFingerprint } : {}),
    ...(input.hostContractFingerprint !== undefined
      ? { hostContractFingerprint: input.hostContractFingerprint }
      : {}),
    externalKind: "model" as const,
    price: Object.freeze({ kind: "unknown" as const }),
    admission: "admitted" as const,
    reservation: Object.freeze({
      kind: "reserved" as const,
      reservationId: `reservation:${actionId}`,
    }),
  };
  if (input.taskAction.kind !== "reuse") {
    return Object.freeze({
      ...common,
      kind: "after_task_output" as const,
      reason: "output_dependency" as const,
    });
  }
  if (
    contractFingerprint === undefined ||
    input.hostContractFingerprint === undefined ||
    input.evidenceStore === undefined
  ) {
    return Object.freeze({
      ...common,
      kind: "execute" as const,
      reason: "identity_unavailable" as const,
    });
  }
  const key = createScorerEvidenceKey({
    cell: input.cell,
    execution: input.taskAction.evidence.result,
    scorerName,
    contractFingerprint,
    hostContractFingerprint: input.hostContractFingerprint,
    occurrence: String(index),
  });
  if (key === undefined) {
    return Object.freeze({
      ...common,
      kind: "execute" as const,
      reason: "identity_unavailable" as const,
    });
  }
  const evidence = readScorerEvidenceEntry(
    await input.evidenceStore.read(key),
    key,
  );
  return evidence === undefined
    ? Object.freeze({
        ...common,
        kind: "execute" as const,
        reason: "no_exact_evidence" as const,
        evidenceKey: key,
      })
    : Object.freeze({
        ...common,
        kind: "reuse" as const,
        reason: "exact_evidence" as const,
        contractFingerprint,
        hostContractFingerprint: input.hostContractFingerprint,
        reservation: Object.freeze({ kind: "released" as const }),
        evidence,
      });
}

function projectScorerContract(
  scorer: Scorer<unknown, unknown, unknown>,
): string | undefined {
  const identity = (scorer as MaybeIdentifiedScorer)[SCORER_IDENTITY];
  if (!isReusableEvalValue(identity)) return undefined;
  return identity === undefined ? undefined : fingerprintEvalValue(identity);
}
