/**
 * Validation helpers for redacted connected-knowledge receipt projections.
 *
 * @module
 */

/** Project trusted knowledge receipt records to the public inspection shape. @internal */
export function projectKnowledgeRecords(value: unknown): readonly object[] {
  return (value as readonly Record<string, unknown>[]).map((record) => ({
    traceId: record.traceId,
    recipeId: record.recipeId,
    fingerprint: record.fingerprint,
    stepId: record.stepId,
    contributor: record.contributor,
    ...(record.view !== undefined ? { view: record.view } : {}),
    generations: [...(record.generations as readonly unknown[])],
    coverage: record.coverage,
    coverageBasis: record.coverageBasis,
    ...(record.scan !== undefined ? { scan: record.scan } : {}),
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
    counts: record.counts,
    ...(record.preflight !== undefined ? { preflight: record.preflight } : {}),
    truncations: [...(record.truncations as readonly unknown[])],
  }));
}

/** Return whether an unknown value is a redacted knowledge receipt. @internal */
export function isKnowledgeReceipt(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.traceId) &&
    isString(value.recipeId) &&
    isString(value.fingerprint) &&
    isString(value.stepId) &&
    isString(value.contributor) &&
    (value.view === undefined ||
      (isRecord(value.view) &&
        isString(value.view.id) &&
        (isString(value.view.viewRevision) || value.view.viewRevision === null))) &&
    isArray(value.generations, isString) &&
    isString(value.coverage) &&
    isString(value.coverageBasis) &&
    (value.scan === undefined || isString(value.scan)) &&
    (value.detail === undefined || isString(value.detail)) &&
    isRecord(value.counts) &&
    isCountRecord(value.counts.available) &&
    isCountRecord(value.counts.processed) &&
    (value.preflight === undefined || isPreflight(value.preflight)) &&
    isArray(value.truncations, isString);
}

function isCountRecord(value: unknown): boolean {
  return isRecord(value) &&
    isNonNegativeNumber(value.reports) &&
    optionalNonNegativeNumber(value.findings);
}

function isPreflight(value: unknown): boolean {
  return isRecord(value) &&
    isNonNegativeNumber(value.reports) &&
    isNonNegativeNumber(value.batches) &&
    isNonNegativeNumber(value.inputChars) &&
    isNonNegativeNumber(value.calls);
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

function isNonNegativeNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0;
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeNumber(value);
}
