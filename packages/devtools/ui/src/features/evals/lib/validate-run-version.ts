import type { EvalRunFailure } from "./validate-run";

type RecordValue = Record<string, unknown>;

/** Validate fields whose meaning differs between retained Run V3 and Run V4. */
export function validateEvalRunVersion(
  run: RecordValue,
  fail: EvalRunFailure,
): void {
  if (run.schemaVersion !== 3 && run.schemaVersion !== 4) fail("envelope");
  const version = run.schemaVersion;
  array(run.cells, "cells", fail).forEach((raw, index) =>
    validateCellVersion(raw, `cells[${index}]`, version, fail),
  );
  const aggregates = object(run.aggregates, "aggregates", fail);
  Object.entries(aggregates).forEach(([name, raw]) =>
    validateAggregateVersion(raw, `aggregates.${name}`, version, fail),
  );
}

function validateCellVersion(
  raw: unknown,
  path: string,
  version: 3 | 4,
  fail: EvalRunFailure,
): void {
  const cell = object(raw, path, fail);
  const task = object(cell.task, `${path}.task`, fail);
  if (version === 3) {
    if (
      cell.status === "timed_out" ||
      task.status === "timed_out" ||
      cell.timeout !== undefined ||
      cell.scorerContracts !== undefined
    ) {
      fail(path);
    }
    return;
  }

  array(cell.scorerContracts, `${path}.scorerContracts`, fail).forEach(
    (rawContract, index) => {
      const contract = object(
        rawContract,
        `${path}.scorerContracts[${index}]`,
        fail,
      );
      if (
        typeof contract.name !== "string" ||
        contract.name.length === 0 ||
        typeof contract.contractFingerprint !== "string" ||
        contract.contractFingerprint.length === 0
      ) {
        fail(`${path}.scorerContracts[${index}]`);
      }
    },
  );

  const timedOut = cell.status === "timed_out";
  if (
    timedOut !== (task.status === "timed_out") ||
    timedOut !== (cell.timeout !== undefined) ||
    (timedOut && cell.error !== undefined)
  ) {
    fail(path);
  }
  if (timedOut) validateTimeout(cell.timeout, `${path}.timeout`, fail);
}

function validateTimeout(
  raw: unknown,
  path: string,
  fail: EvalRunFailure,
): void {
  const timeout = object(raw, path, fail);
  if (
    !oneOf(timeout.budget, ["total", "step", "chunk", "firstToken", "tool"]) ||
    !positive(timeout.limitMs) ||
    (timeout.budget === "tool") !==
      (typeof timeout.toolName === "string" && timeout.toolName.length > 0)
  ) {
    fail(path);
  }
}

function validateAggregateVersion(
  raw: unknown,
  path: string,
  version: 3 | 4,
  fail: EvalRunFailure,
): void {
  const aggregate = object(raw, path, fail);
  if (version === 3) {
    if (aggregate.timedOut !== undefined) fail(`${path}.timedOut`);
    return;
  }
  if (
    !nonnegativeInteger(aggregate.timedOut) ||
    !nonnegativeInteger(aggregate.cells) ||
    !nonnegativeInteger(aggregate.passed) ||
    !nonnegativeInteger(aggregate.failed) ||
    !nonnegativeInteger(aggregate.errored) ||
    aggregate.cells !==
      aggregate.passed +
        aggregate.failed +
        aggregate.errored +
        aggregate.timedOut
  ) {
    fail(path);
  }
}

function array(value: unknown, path: string, fail: EvalRunFailure): unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}

function object(
  value: unknown,
  path: string,
  fail: EvalRunFailure,
): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path);
  }
  return value as RecordValue;
}

function oneOf<const T extends readonly unknown[]>(
  value: unknown,
  choices: T,
): value is T[number] {
  return choices.includes(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
