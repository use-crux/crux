import type { EvalRunFailure } from "./validate-run";

const EXECUTE_REASON = [
  "live_required",
  "fresh_requested",
  "performance_freshness",
  "no_exact_evidence",
  "identity_unavailable",
  "model_identity_unattested",
  "untracked_external_dependency",
  "nondeterministic_renderer",
  "task_binding_untracked",
  "unresolved_source_dependency",
  "implicit_media",
  "registry_identity_unavailable",
  "host_contract_unavailable",
] as const;

/** Validate the version-neutral task decision stored on one Eval cell. */
export function validateEvalRunTask(
  raw: unknown,
  path: string,
  fail: EvalRunFailure,
): void {
  const task = object(raw, path, fail);
  if (task.status === "executed") {
    if (
      !oneOf(task.reason, EXECUTE_REASON) ||
      !optionalString(task.evidenceFingerprint) ||
      !optionalString(task.evidenceRef) ||
      !optionalString(task.freshnessSource)
    )
      fail(path);
    return;
  }
  if (task.status === "reused") {
    if (
      task.reason !== "exact_evidence" ||
      typeof task.evidenceFingerprint !== "string" ||
      typeof task.evidenceRef !== "string" ||
      task.freshnessSource !== undefined
    )
      fail(path);
    return;
  }
  if (task.status === "errored" || task.status === "skipped") {
    const reason = task.status === "errored" ? "task_error" : "source_skipped";
    if (
      task.reason !== reason ||
      task.evidenceFingerprint !== undefined ||
      task.evidenceRef !== undefined ||
      task.freshnessSource !== undefined
    )
      fail(path);
    return;
  }
  if (
    task.status !== "timed_out" ||
    task.reason !== undefined ||
    task.evidenceFingerprint !== undefined ||
    task.evidenceRef !== undefined ||
    task.freshnessSource !== undefined
  ) {
    fail(`${path}.status`);
  }
}

function object(
  value: unknown,
  path: string,
  fail: EvalRunFailure,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path);
  }
  return value as Record<string, unknown>;
}

function oneOf<const T extends readonly unknown[]>(
  value: unknown,
  choices: T,
): value is T[number] {
  return choices.includes(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
