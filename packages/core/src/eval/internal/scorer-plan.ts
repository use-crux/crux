/** Planning helpers for explicit managed external-scorer actions. @internal */

import { boundScorerLib, type Scorer } from "./scorers/types";
import {
  SCORER_IDENTITY,
  SCORER_DEPENDENCIES,
  SCORER_BINDING,
  type MaybeIdentifiedScorer,
} from "./scorers/runtime";
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
import {
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "./task";

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
  readonly actionPrefix?: string;
  readonly bypassEvidenceReason?: "fresh_requested" | "performance_freshness";
  readonly authoredSourceFingerprint?: string;
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
  const actionId = `${input.actionPrefix ?? "score"}:score:${index}:${scorerName}`;
  const contractFingerprint = projectScorerContract(
    scorer,
    input.cell,
    input.authoredSourceFingerprint,
  );
  const dependencies = projectScorerDependencies(scorer);
  const common = {
    actionId,
    dependency: "task:root" as const,
    scorerName,
    occurrence: String(index),
    dependencies,
    scorer,
    ...(contractFingerprint !== undefined ? { contractFingerprint } : {}),
    ...(input.hostContractFingerprint !== undefined
      ? { hostContractFingerprint: input.hostContractFingerprint }
      : {}),
    externalKind: "model" as const,
    price: Object.freeze({ kind: "unknown" as const }),
    admission: "admitted" as const,
    evidenceRead:
      input.bypassEvidenceReason !== undefined
        ? ("bypass" as const)
        : ("allow" as const),
    ...(input.bypassEvidenceReason !== undefined
      ? { evidenceReadReason: input.bypassEvidenceReason }
      : {}),
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
  if (input.bypassEvidenceReason !== undefined) {
    return Object.freeze({
      ...common,
      kind: "execute" as const,
      reason: input.bypassEvidenceReason,
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
    dependencies,
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

function projectScorerDependencies(scorer: Scorer<unknown, unknown, unknown>) {
  const declared = (scorer as MaybeIdentifiedScorer)[SCORER_DEPENDENCIES];
  return Object.freeze(
    declared === undefined
      ? ([
          "input",
          "output",
          "expected",
          "response",
          "capturedSignals",
        ] as const)
      : [...declared],
  );
}

function projectScorerContract(
  scorer: Scorer<unknown, unknown, unknown>,
  cell: EvalPlannedCell,
  authoredSourceFingerprint: string | undefined,
): string | undefined {
  const identity = (scorer as MaybeIdentifiedScorer)[SCORER_IDENTITY];
  if (!isReusableEvalValue(identity)) return undefined;
  if (identity === undefined || !isManagedEvalTaskForInternalUse(cell.task)) {
    return undefined;
  }
  const descriptor = getEvalTaskDescriptorForInternalUse(cell.task);
  if (descriptor.projectScorerContext === undefined) return undefined;
  const binding = (scorer as MaybeIdentifiedScorer)[SCORER_BINDING];
  if (
    binding?.hasAuthoredSelect === true &&
    authoredSourceFingerprint === undefined
  ) {
    return undefined;
  }
  const context = descriptor.projectScorerContext({
    input: cell.input,
    ...(cell.call !== undefined ? { call: cell.call } : {}),
    overrides: cell.overrides,
    ...(binding?.model !== undefined ? { model: binding.model } : {}),
    ...(binding?.generate !== undefined ? { generate: binding.generate } : {}),
    ...(authoredSourceFingerprint !== undefined
      ? { authoredSourceFingerprint }
      : {}),
  });
  if (!context.reusable || !isReusableEvalValue(context.fingerprintMaterial)) {
    return undefined;
  }
  return fingerprintEvalValue({
    scorer: identity,
    context: context.fingerprintMaterial,
    ...(authoredSourceFingerprint !== undefined
      ? { authoredSourceFingerprint }
      : {}),
  });
}
