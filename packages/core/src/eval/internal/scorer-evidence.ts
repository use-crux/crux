/** Portable exact evidence for one managed external scorer action. @internal */

import type { Score } from "./scorers/types";
import { SCORER_RESULT_CACHE_EPOCH } from "./evidence/cache-epochs";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import type { EvalPlannedCell, EvalTaskExecutionEvidence } from "./types";
import type { ScorerEvidenceDependency } from "./scorers/runtime";
import {
  isEvalSnapshotPersistenceSafe,
  type EvalPersistencePolicy,
} from "./redact";

export interface EvalScorerEvidenceEntry {
  readonly schemaVersion: 1;
  readonly scorerResultCacheEpoch: typeof SCORER_RESULT_CACHE_EPOCH;
  readonly status: "complete";
  readonly key: string;
  readonly fingerprint: string;
  readonly score: Readonly<Score>;
}

export function createScorerEvidenceKey(input: {
  readonly cell: EvalPlannedCell;
  readonly execution: EvalTaskExecutionEvidence;
  readonly scorerName: string;
  readonly contractFingerprint: string;
  readonly hostContractFingerprint: string;
  readonly occurrence: string;
  readonly dependencies: readonly ScorerEvidenceDependency[];
}): string | undefined {
  const dependencies = new Set(input.dependencies);
  const material = {
    scorerResultCacheEpoch: SCORER_RESULT_CACHE_EPOCH,
    ...(dependencies.has("input") ? { input: input.cell.input } : {}),
    ...(dependencies.has("expected")
      ? { expected: input.cell.expected ?? null }
      : {}),
    ...(dependencies.has("output") ? { output: input.execution.output } : {}),
    ...(dependencies.has("response")
      ? { response: input.execution.response }
      : {}),
    ...(dependencies.has("capturedSignals")
      ? { capturedSignals: input.execution.capturedSignals }
      : {}),
    scorerName: input.scorerName,
    contractFingerprint: input.contractFingerprint,
    hostContractFingerprint: input.hostContractFingerprint,
    variant: input.cell.variant,
    trial: input.cell.trial,
    occurrence: input.occurrence,
  };
  return isReusableEvalValue(material)
    ? fingerprintEvalValue(material)
    : undefined;
}

export function createScorerEvidenceEntry(
  key: string,
  score: Score,
  policy?: EvalPersistencePolicy,
): EvalScorerEvidenceEntry | undefined {
  if (
    !isValidScore(score) ||
    !isReusableEvalValue(score) ||
    !isEvalSnapshotPersistenceSafe(score, policy)
  )
    return undefined;
  return Object.freeze({
    schemaVersion: 1,
    scorerResultCacheEpoch: SCORER_RESULT_CACHE_EPOCH,
    status: "complete",
    key,
    fingerprint: key,
    score: freezeScore(score),
  });
}

export function readScorerEvidenceEntry(
  value: unknown,
  key: string,
): EvalScorerEvidenceEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.schemaVersion !== 1 ||
    value.scorerResultCacheEpoch !== SCORER_RESULT_CACHE_EPOCH ||
    value.status !== "complete" ||
    value.key !== key ||
    value.fingerprint !== key ||
    !isValidScore(value.score)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(value as unknown as EvalScorerEvidenceEntry),
    score: freezeScore(value.score),
  });
}

function isValidScore(value: unknown): value is Score {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  return (
    value.score === null ||
    (typeof value.score === "number" &&
      Number.isFinite(value.score) &&
      value.score >= 0 &&
      value.score <= 1)
  );
}

function freezeScore(score: Score): Readonly<Score> {
  return Object.freeze({
    ...score,
    ...(score.metadata !== undefined
      ? { metadata: Object.freeze({ ...score.metadata }) }
      : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
