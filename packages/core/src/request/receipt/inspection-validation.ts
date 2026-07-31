/**
 * Validation for request inspection loaded from an untrusted destination.
 *
 * @module
 */

import type { RequestInspection } from "./inspection";

/** Validate and freeze one cross-process inspection result. @internal */
export function validatedRequestInspection(
  value: unknown,
  expectedId: string,
): RequestInspection | undefined {
  if (!isRecord(value) || value.id !== expectedId) return undefined;
  if (
    !isArray(value.contributions, isContribution) ||
    !isArray(value.candidates, isCandidate) ||
    !isBreakdown(value.breakdown) ||
    !isMeasurement(value.measurement) ||
    !isCounting(value.counting) ||
    !isNonNegativeInteger(value.retryCount) ||
    !isArray(value.artifacts, isArtifact) ||
    !isArray(value.supportTools, isString) ||
    !isArray(value.supportRequests, isSupportRequest) ||
    !isArray(value.linkedRequestIds, isString) ||
    !isPreparation(value.preparation) ||
    value.retention !== "requires observability retention"
  ) {
    return undefined;
  }
  return deepFreeze(projectInspection(value)) as unknown as RequestInspection;
}

function projectInspection(value: Record<string, unknown>): object {
  const breakdown = value.breakdown as Record<string, unknown>;
  const counting = value.counting as Record<string, unknown>;
  return {
    id: value.id,
    contributions: projectRecords(value.contributions, [
      "id",
      "sources",
      "priority",
      "boundary",
      "representations",
    ]),
    candidates: projectRecords(value.candidates, [
      "contributor",
      "representation",
      "available",
      "selected",
      "inputTokens",
      "rejectionReason",
    ]),
    breakdown: {
      total: breakdown.total,
      attribution: breakdown.attribution,
      contributions: projectRecords(breakdown.contributions, [
        "contributor", "tokens",
      ]),
    },
    measurement: value.measurement,
    counting: {
      measurement: counting.measurement,
      attribution: counting.attribution,
      safetyMarginTokens: counting.safetyMarginTokens,
      providerOverheadTokens: counting.providerOverheadTokens,
    },
    retryCount: value.retryCount,
    artifacts: projectRecords(value.artifacts, [
      "contributor", "kind", "supportRequestIds",
    ]),
    supportTools: [...(value.supportTools as readonly unknown[])],
    supportRequests: projectRecords(value.supportRequests, [
      "id",
      "model",
      "inputTokens",
      "maxInputTokens",
      "measurement",
    ]),
    linkedRequestIds: [...(value.linkedRequestIds as readonly unknown[])],
    ...(value.preparation !== undefined
      ? { preparation: projectPreparation(value.preparation) }
      : {}),
    retention: "requires observability retention",
  };
}

function projectPreparation(value: unknown): object {
  const preparation = value as Record<string, unknown>;
  const amendment = preparation.amendment as Record<string, unknown>;
  return {
    operation: preparation.operation,
    stepIndex: preparation.stepIndex,
    reason: preparation.reason,
    amendment: {
      addedContributors: amendment.addedContributors,
      removedContributors: amendment.removedContributors,
      contributedTools: amendment.contributedTools,
      activeTools: amendment.activeTools,
      modelChanged: amendment.modelChanged,
      inputBudgetChanged: amendment.inputBudgetChanged,
    },
    resources: projectRecords(preparation.resources, [
      "identity", "revision", "valueHash",
    ]),
    sealedRequestId: preparation.sealedRequestId,
  };
}

function projectRecords(
  value: unknown,
  keys: readonly string[],
): readonly object[] {
  return (value as readonly Record<string, unknown>[]).map((record) => {
    const projected: Record<string, unknown> = {};
    for (const key of keys) {
      if (record[key] !== undefined) projected[key] = record[key];
    }
    return projected;
  });
}

function isContribution(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.id) &&
    isArray(value.sources, isString) &&
    isFiniteNumber(value.priority) &&
    (value.boundary === "required" ||
      value.boundary === "sticky" ||
      value.boundary === "elastic") &&
    isArray(value.representations, isString);
}

function isCandidate(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.contributor) &&
    isString(value.representation) &&
    typeof value.available === "boolean" &&
    typeof value.selected === "boolean" &&
    optionalNonNegativeNumber(value.inputTokens) &&
    (value.rejectionReason === undefined ||
      value.rejectionReason === "over-limit" ||
      value.rejectionReason === "lower-fidelity" ||
      value.rejectionReason === "unprepared");
}

function isBreakdown(value: unknown): boolean {
  return isRecord(value) &&
    isNonNegativeNumber(value.total) &&
    value.attribution === "estimated" &&
    isArray(value.contributions, (entry) =>
      isRecord(entry) &&
      isString(entry.contributor) &&
      isNonNegativeNumber(entry.tokens));
}

function isCounting(value: unknown): boolean {
  return isRecord(value) &&
    isMeasurement(value.measurement) &&
    value.attribution === "estimated" &&
    isNonNegativeNumber(value.safetyMarginTokens) &&
    isNonNegativeNumber(value.providerOverheadTokens);
}

function isArtifact(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.contributor) &&
    (value.kind === "summary" || value.kind === "offload") &&
    isArray(value.supportRequestIds, isString);
}

function isSupportRequest(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.id) &&
    isString(value.model) &&
    isNonNegativeNumber(value.inputTokens) &&
    isNonNegativeNumber(value.maxInputTokens) &&
    isMeasurement(value.measurement);
}

function isPreparation(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    !isRecord(value) ||
    value.operation !== "language" ||
    !isNonNegativeInteger(value.stepIndex) ||
    (value.reason !== "initial" &&
      value.reason !== "tool-result" &&
      value.reason !== "validation-retry") ||
    !isRecord(value.amendment) ||
    !isNonNegativeInteger(value.amendment.addedContributors) ||
    !isNonNegativeInteger(value.amendment.removedContributors) ||
    !isNonNegativeInteger(value.amendment.contributedTools) ||
    !optionalNonNegativeInteger(value.amendment.activeTools) ||
    typeof value.amendment.modelChanged !== "boolean" ||
    typeof value.amendment.inputBudgetChanged !== "boolean" ||
    !isArray(value.resources, (resource) =>
      isRecord(resource) &&
      isString(resource.identity) &&
      isString(resource.revision) &&
      isString(resource.valueHash),
    ) ||
    !isString(value.sealedRequestId)
  ) {
    return false;
  }
  return true;
}

function isMeasurement(value: unknown): boolean {
  return value === "exact" || value === "estimated" || value === "conservative";
}

function isArray(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is readonly unknown[] {
  return Array.isArray(value) && value.every(predicate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeNumber(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}
