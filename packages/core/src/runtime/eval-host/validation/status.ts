import type { EvalHostJobStatusV1, EvalHostJobStatusV2 } from "../types";
import { EVAL_HOST_MAX_DEADLINE_HORIZON_MS } from "../protocol";
import { hasExactKeys, isCanonicalTimestamp, isRecord } from "./common";

/** Validate one exact legacy V1 job projection. */
export function decodeEvalHostJobStatusV1(value: unknown): EvalHostJobStatusV1 {
  return decodeStatus(value, "v1") as EvalHostJobStatusV1;
}

/** Validate one exact V2 job projection with structured expiration metadata. */
export function decodeEvalHostJobStatusV2(value: unknown): EvalHostJobStatusV2 {
  return decodeStatus(value, "v2") as EvalHostJobStatusV2;
}

/** Validate the current V2 projection before the coordinator consumes it. */
export const decodeEvalHostJobStatus = decodeEvalHostJobStatusV2;

function decodeStatus(value: unknown, protocol: "v1" | "v2"): unknown {
  if (!isRecord(value) || typeof value.status !== "string") return invalid();
  const terminal =
    value.status === "succeeded"
      ? ["resultRef", "result"]
      : value.status === "failed" ||
          value.status === "cancelled" ||
          value.status === "expired"
        ? [
            "error",
            ...(protocol === "v2" && value.status === "expired"
              ? ["timeout"]
              : []),
          ]
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
      !isError(value.error)) ||
    (protocol === "v2" &&
      value.status === "expired" &&
      !isTimeout(value.timeout))
  )
    return invalid();
  return value;
}

function isTimeout(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "budget",
      "limitMs",
      "phase",
      ...(value.toolName === undefined ? [] : ["toolName"]),
    ]) ||
    !["total", "step", "chunk", "firstToken", "tool"].includes(
      value.budget as string,
    ) ||
    !Number.isSafeInteger(value.limitMs) ||
    (value.limitMs as number) <= 0 ||
    (value.limitMs as number) > EVAL_HOST_MAX_DEADLINE_HORIZON_MS ||
    (value.phase !== "pre_start" && value.phase !== "in_flight") ||
    (value.toolName !== undefined &&
      (value.budget !== "tool" || typeof value.toolName !== "string"))
  ) {
    return false;
  }
  return true;
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
