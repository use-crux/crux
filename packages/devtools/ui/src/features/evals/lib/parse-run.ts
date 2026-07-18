import type { EvalRunRecord } from "../types";
import { validateEvalRunBody } from "./validate-run";

export function parseEvalRunList(value: unknown): readonly EvalRunRecord[] {
  if (!Array.isArray(value)) throw new TypeError("malformed Eval run list");
  return value.map((entry, index) => parseEvalRun(entry, `[${index}]`));
}

export function parseEvalRun(value: unknown, prefix = ""): EvalRunRecord {
  const run = record(value, `run${prefix}`);
  const runId = typeof run.runId === "string" ? run.runId : "unknown";
  const fail = (path: string): never => {
    throw new TypeError(`malformed Eval run '${runId}' at ${path}`);
  };
  if (
    run.schemaVersion !== 3 ||
    typeof run.runId !== "string" ||
    typeof run.evalId !== "string" ||
    typeof run.definitionFingerprint !== "string" ||
    !isSourceKey(run.sourceKey) ||
    (run.status !== "complete" && run.status !== "incomplete") ||
    typeof run.passed !== "boolean" ||
    !Array.isArray(run.cells)
  )
    fail("envelope");
  validateEvalRunBody(run, fail);
  return run as unknown as EvalRunRecord;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new TypeError(`malformed Eval artifact at ${path}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceKey(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.relativeFile === "string" &&
    value.export === "default"
  );
}
