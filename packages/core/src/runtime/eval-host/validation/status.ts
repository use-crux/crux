import type { EvalHostJobStatusV1 } from "../types";
import { hasExactKeys, isCanonicalTimestamp, isRecord } from "./common";

/** Validate one exact job projection before the coordinator consumes it. */
export function decodeEvalHostJobStatus(value: unknown): EvalHostJobStatusV1 {
  if (!isRecord(value) || typeof value.status !== "string") return invalid();
  const terminal =
    value.status === "succeeded"
      ? ["resultRef", "result"]
      : value.status === "failed" ||
          value.status === "cancelled" ||
          value.status === "expired"
        ? ["error"]
        : [];
  if (
    !hasExactKeys(value, [
      "jobId",
      "evalRunId",
      "attempt",
      "revision",
      "createdAt",
      "updatedAt",
      "status",
      ...terminal,
    ]) ||
    typeof value.jobId !== "string" ||
    typeof value.evalRunId !== "string" ||
    !Number.isSafeInteger(value.attempt) ||
    (value.attempt as number) < 0 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    ![
      "accepted",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ].includes(value.status) ||
    (value.status === "succeeded" &&
      (!isResultRef(value.resultRef) || !("result" in value))) ||
    ((value.status === "failed" ||
      value.status === "cancelled" ||
      value.status === "expired") &&
      !isError(value.error))
  )
    return invalid();
  return value as unknown as EvalHostJobStatusV1;
}

function isResultRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["sha256", "size", "mediaType", "location"]) &&
    typeof value.sha256 === "string" &&
    Number.isSafeInteger(value.size) &&
    (value.size as number) >= 0 &&
    value.mediaType === "application/vnd.crux.eval-result+json" &&
    typeof value.location === "string"
  );
}

function isError(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "message", "retryable", "phase"]) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    value.retryable === false &&
    ["auth", "admission", "execute", "result", "transport"].includes(
      value.phase as string,
    )
  );
}

function invalid(): never {
  throw new TypeError("Eval host returned an incompatible job status.");
}
