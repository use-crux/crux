import { validateEvalRunTask } from "./validate-run-task";
import { validateEvalRunVersion } from "./validate-run-version";

type RecordValue = Record<string, unknown>;
export type EvalRunFailure = (path: string) => never;

const CELL_STATUS = [
  "passed",
  "failed",
  "errored",
  "skipped",
  "timed_out",
] as const;
const INCOMPLETE_REASON = [
  "task_error",
  "assertion_error",
  "scorer_error",
  "baseline_missing",
  "baseline_evidence_incomplete",
  "score_missing",
  "score_null",
  "score_errored",
  "cost_missing",
] as const;

export function validateEvalRunBody(
  run: RecordValue,
  fail: EvalRunFailure,
): void {
  validateEvalRunVersion(run, fail);
  if (!nonnegative(run.startedAt) || !nonnegative(run.endedAt))
    fail("timestamps");
  validateSelection(object(run.selection, "selection", fail), fail);
  if (!oneOf(run.costControl, ["not_required", "max_cost", "unknown"]))
    fail("costControl");
  stringArray(run.blockingVariants, "blockingVariants", fail);
  array(run.cells, "cells", fail).forEach((cell, index) =>
    validateCell(cell, `cells[${index}]`, fail),
  );
  array(run.variants, "variants", fail).forEach((raw, index) => {
    const value = object(raw, `variants[${index}]`, fail);
    if (
      typeof value.name !== "string" ||
      typeof value.fingerprint !== "string" ||
      typeof value.blocking !== "boolean"
    )
      fail(`variants[${index}]`);
    stringArray(value.overrideKeys, `variants[${index}].overrideKeys`, fail);
  });
  const aggregates = object(run.aggregates, "aggregates", fail);
  Object.entries(aggregates).forEach(([name, value]) =>
    validateAggregate(value, `aggregates.${name}`, fail),
  );
  if (run.comparison !== undefined) validateComparison(run.comparison, fail);
  validateGates(run.gates, fail);
  validateCost(run.cost, fail);
  validateProvenance(run.provenance, fail);
  if (run.status === "incomplete") {
    if (run.passed !== false) fail("passed");
    array(run.reasons, "reasons", fail).forEach((reason, index) => {
      if (!oneOf(reason, INCOMPLETE_REASON)) fail(`reasons[${index}]`);
    });
  }
}

function validateSelection(value: RecordValue, fail: EvalRunFailure): void {
  stringArray(value.cases, "selection.cases", fail);
  stringArray(value.variants, "selection.variants", fail);
  if (!positiveInteger(value.trials)) fail("selection.trials");
  const caseTrials = object(value.caseTrials, "selection.caseTrials", fail);
  for (const [caseId, trials] of Object.entries(caseTrials))
    if (!positiveInteger(trials)) fail(`selection.caseTrials.${caseId}`);
  if (value.filtered !== undefined && value.filtered !== true)
    fail("selection.filtered");
}

function validateCell(raw: unknown, path: string, fail: EvalRunFailure): void {
  const cell = object(raw, path, fail);
  if (
    typeof cell.caseId !== "string" ||
    typeof cell.variant !== "string" ||
    !nonnegativeInteger(cell.trial) ||
    !oneOf(cell.status, CELL_STATUS)
  )
    fail(path);
  validateEvalRunTask(cell.task, `${path}.task`, fail);
  array(cell.scores, `${path}.scores`, fail).forEach((score, index) =>
    validateScore(score, `${path}.scores[${index}]`, fail),
  );
  validateAssertions(cell.assertions, `${path}.assertions`, fail);
  if (!("input" in cell)) fail(`${path}.input`);
  if (cell.call !== undefined && !isRecord(cell.call)) fail(`${path}.call`);
  if (cell.response !== undefined && !isRecord(cell.response))
    fail(`${path}.response`);
  if (
    cell.unvalidatedExpected !== undefined &&
    cell.unvalidatedExpected !== true
  )
    fail(`${path}.unvalidatedExpected`);
  if (cell.error !== undefined) {
    const error = object(cell.error, `${path}.error`, fail);
    if (
      typeof error.message !== "string" ||
      !oneOf(error.phase, ["execute", "expect", "afterScores", "score"])
    )
      fail(`${path}.error`);
  }
  const metrics = object(cell.metrics, `${path}.metrics`, fail);
  if (
    !nonnegative(metrics.durationMs) ||
    (metrics.costUsd !== undefined && !nonnegative(metrics.costUsd))
  )
    fail(`${path}.metrics`);
  stringArray(cell.runIds, `${path}.runIds`, fail);
  stringArray(cell.capturedSignals, `${path}.capturedSignals`, fail);
}

function validateScore(raw: unknown, path: string, fail: EvalRunFailure): void {
  const score = object(raw, path, fail);
  if (
    typeof score.name !== "string" ||
    score.name.length === 0 ||
    typeof score.contractFingerprint !== "string" ||
    score.contractFingerprint.length === 0
  )
    fail(path);
  if (score.status === "computed") {
    if (!scoreValue(score.value) || score.message !== undefined) fail(path);
    if (score.reason === "deterministic_local") {
      if (score.work !== undefined || score.metrics !== undefined) fail(path);
    } else if (
      score.reason !== "managed_external_executed" ||
      !validScoreMetrics(score.metrics) ||
      !validWork(
        score.work,
        "executed",
        [
          "fresh_requested",
          "performance_freshness",
          "no_exact_evidence",
          "identity_unavailable",
          "exact_evidence",
        ],
        "consumed",
      )
    )
      fail(path);
    return;
  }
  if (score.status === "reused") {
    if (
      score.reason !== "managed_external_reused" ||
      !scoreValue(score.value) ||
      score.message !== undefined ||
      score.metrics !== undefined ||
      !validWork(score.work, "reused", ["exact_evidence"], "released")
    )
      fail(path);
    return;
  }
  if (score.status === "missing") {
    if (
      score.reason !== "dependency_failed" ||
      score.value !== undefined ||
      score.label !== undefined ||
      score.rationale !== undefined ||
      score.metrics !== undefined ||
      typeof score.message !== "string" ||
      !validWork(
        score.work,
        "not_called",
        ["dependency_failed"],
        "released",
        false,
      )
    )
      fail(path);
    return;
  }
  if (score.status === "errored") {
    if (
      score.reason !== "scorer_error" ||
      score.value !== undefined ||
      score.label !== undefined ||
      score.rationale !== undefined ||
      score.metrics !== undefined ||
      typeof score.message !== "string"
    )
      fail(path);
    if (score.work === undefined) return;
    if (
      !validWork(score.work, "errored", ["scorer_error"], "consumed", false) &&
      !validWork(score.work, "not_called", ["scorer_error"], "released", false)
    )
      fail(path);
    return;
  }
  fail(`${path}.status`);
}

function validScoreMetrics(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return false;
  const metrics = raw as Record<string, unknown>;
  if (metrics.actualUsd !== undefined && !nonnegative(metrics.actualUsd)) {
    return false;
  }
  if (metrics.usage === undefined) return true;
  if (
    metrics.usage === null ||
    typeof metrics.usage !== "object" ||
    Array.isArray(metrics.usage)
  ) {
    return false;
  }
  const usage = metrics.usage as Record<string, unknown>;
  return [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
    nonnegativeInteger,
  );
}

function validWork(
  raw: unknown,
  status: string,
  reasons: readonly string[],
  reservation: string,
  allowEvidence = true,
): boolean {
  if (
    !isRecord(raw) ||
    raw.status !== status ||
    !oneOf(raw.reason, reasons) ||
    raw.reservation !== reservation
  )
    return false;
  return allowEvidence
    ? optionalString(raw.evidenceRef)
    : raw.evidenceRef === undefined;
}

function validateAssertions(
  raw: unknown,
  path: string,
  fail: EvalRunFailure,
): void {
  const value = object(raw, path, fail);
  if (!nonnegativeInteger(value.ran) || !nonnegativeInteger(value.notEvaluated))
    fail(path);
  array(value.outcomes, `${path}.outcomes`, fail).forEach(
    (rawOutcome, index) => {
      const outcome = object(rawOutcome, `${path}.outcomes[${index}]`, fail);
      if (
        typeof outcome.id !== "string" ||
        !oneOf(outcome.level, ["eval", "case"]) ||
        !oneOf(outcome.phase, ["expect", "afterScores"]) ||
        !nonnegativeInteger(outcome.index) ||
        !oneOf(outcome.status, [
          "passed",
          "failed",
          "not-evaluated",
          "uncaptured",
        ]) ||
        typeof outcome.matcher !== "string" ||
        typeof outcome.soft !== "boolean"
      )
        fail(`${path}.outcomes[${index}]`);
    },
  );
}

function validateAggregate(
  raw: unknown,
  path: string,
  fail: EvalRunFailure,
): void {
  const value = object(raw, path, fail);
  for (const field of [
    "cells",
    "passed",
    "failed",
    "errored",
    "skipped",
  ] as const)
    if (!nonnegativeInteger(value[field])) fail(`${path}.${field}`);
  if (
    !unitNumber(value.passRate) ||
    !unitNumber(value.trialConsistency) ||
    !nonnegative(value.latencyMs) ||
    (value.knownCostUsd !== undefined && !nonnegative(value.knownCostUsd))
  )
    fail(path);
  const scores = object(value.scores, `${path}.scores`, fail);
  Object.entries(scores).forEach(([name, rawScore]) => {
    const score = object(rawScore, `${path}.scores.${name}`, fail);
    if (
      !finite(score.mean) ||
      !nonnegative(score.sem) ||
      !nonnegativeInteger(score.n)
    )
      fail(`${path}.scores.${name}`);
  });
}

function validateComparison(raw: unknown, fail: EvalRunFailure): void {
  const value = object(raw, "comparison", fail);
  if (
    typeof value.baselineId !== "string" ||
    typeof value.baselineRunId !== "string" ||
    typeof value.selectedArm !== "string"
  )
    fail("comparison");
  array(value.cases, "comparison.cases", fail).forEach((rawCase, caseIndex) => {
    const path = `comparison.cases[${caseIndex}]`;
    const comparedCase = object(rawCase, path, fail);
    if (
      typeof comparedCase.caseId !== "string" ||
      !oneOf(comparedCase.status, ["compatible", "missing", "incompatible"]) ||
      !optionalString(comparedCase.reason)
    )
      fail(path);
    array(comparedCase.metrics, `${path}.metrics`, fail).forEach(
      (rawMetric, metricIndex) => {
        const metricPath = `${path}.metrics[${metricIndex}]`;
        const metric = object(rawMetric, metricPath, fail);
        if (typeof metric.name !== "string") fail(metricPath);
        if (metric.status === "compatible") {
          if (
            !nullableFinite(metric.baseline) ||
            !nullableFinite(metric.candidate) ||
            !nullableFinite(metric.delta)
          )
            fail(metricPath);
        } else if (
          (metric.status !== "missing" && metric.status !== "incompatible") ||
          typeof metric.reason !== "string"
        )
          fail(metricPath);
      },
    );
  });
  const unmatched = object(
    value.unmatchedCases,
    "comparison.unmatchedCases",
    fail,
  );
  stringArray(
    unmatched.baselineOnly,
    "comparison.unmatchedCases.baselineOnly",
    fail,
  );
  stringArray(
    unmatched.candidateOnly,
    "comparison.unmatchedCases.candidateOnly",
    fail,
  );
}

function validateGates(raw: unknown, fail: EvalRunFailure): void {
  const value = object(raw, "gates", fail);
  if (
    typeof value.passed !== "boolean" ||
    typeof value.blockingPassed !== "boolean"
  )
    fail("gates");
  array(value.results, "gates.results", fail).forEach((rawResult, index) => {
    const path = `gates.results[${index}]`;
    const result = object(rawResult, path, fail);
    if (
      typeof result.gate !== "string" ||
      typeof result.variantName !== "string" ||
      (!finite(result.threshold) && typeof result.threshold !== "boolean") ||
      (!finite(result.actual) && typeof result.actual !== "boolean") ||
      typeof result.passed !== "boolean" ||
      (result.informational !== undefined && result.informational !== true) ||
      (result.evidence !== undefined &&
        !oneOf(result.evidence, ["complete", "incomplete"])) ||
      (result.reason !== undefined &&
        !oneOf(result.reason, [
          "baseline_missing",
          "baseline_evidence_incomplete",
          "score_missing",
          "score_null",
          "score_errored",
          "cost_missing",
        ])) ||
      !optionalString(result.remediation)
    )
      fail(path);
  });
}

function validateCost(raw: unknown, fail: EvalRunFailure): void {
  const value = object(raw, "cost", fail);
  if (
    (value.actualUsd !== undefined && !nonnegative(value.actualUsd)) ||
    !nonnegative(value.reservedMaximumUsd) ||
    !nonnegativeInteger(value.unknownActionCount)
  )
    fail("cost");
  for (const field of ["task", "judge"] as const) {
    const part = object(value[field], `cost.${field}`, fail);
    if (part.actualUsd !== undefined && !nonnegative(part.actualUsd))
      fail(`cost.${field}`);
  }
}

function validateProvenance(raw: unknown, fail: EvalRunFailure): void {
  const value = object(raw, "provenance", fail);
  if (!oneOf(value.task, ["managed", "opaque"]) || value.host !== "injected")
    fail("provenance");
  if (value.evidenceStore === "none") return;
  const store = object(value.evidenceStore, "provenance.evidenceStore", fail);
  if (
    typeof store.identity !== "string" ||
    !oneOf(store.consistency, ["read_after_write", "eventual"]) ||
    !oneOf(store.write, [
      "written",
      "failed",
      "not_eligible",
      "not_attempted",
    ]) ||
    (store.writeReason !== undefined &&
      !oneOf(store.writeReason, [
        "identity_unavailable",
        "model_identity_unattested",
        "untracked_external_dependency",
        "task_binding_untracked",
        "unresolved_source_dependency",
        "implicit_media",
        "capture_policy",
        "observed_identity_mismatch",
      ]))
  )
    fail("provenance.evidenceStore");
}

function object(
  value: unknown,
  path: string,
  fail: EvalRunFailure,
): RecordValue {
  if (!isRecord(value)) fail(path);
  return value;
}
function array(
  value: unknown,
  path: string,
  fail: EvalRunFailure,
): readonly unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}
function stringArray(value: unknown, path: string, fail: EvalRunFailure): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    fail(path);
}
function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function nonnegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}
function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}
function unitNumber(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}
function nullableFinite(value: unknown): boolean {
  return value === null || finite(value);
}
function scoreValue(value: unknown): boolean {
  return value === null || unitNumber(value);
}
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
