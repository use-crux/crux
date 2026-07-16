import { CRUX_EVAL_HOST_PROTOCOL, type EvalHostManifestV1 } from "../types";
import { hasExactKeys, isRecord } from "./common";

/** Validate an authenticated host manifest before coordinator preflight. */
export function decodeEvalHostManifest(value: unknown): EvalHostManifestV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocol",
      "deploymentId",
      "hostKind",
      "capabilities",
      "resultMaxBytes",
      "evals",
    ]) ||
    value.protocol !== CRUX_EVAL_HOST_PROTOCOL ||
    typeof value.deploymentId !== "string" ||
    !["memory", "node", "serverless", "convex", "cloudflare"].includes(
      value.hostKind as string,
    ) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((entry) => typeof entry === "string") ||
    !Number.isSafeInteger(value.resultMaxBytes) ||
    (value.resultMaxBytes as number) <= 0 ||
    !Array.isArray(value.evals) ||
    !value.evals.every(isManifestEntry)
  ) {
    throw new TypeError("Eval host returned an incompatible manifest.");
  }
  return value as unknown as EvalHostManifestV1;
}

function isManifestEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "evalFingerprint",
      "cases",
      "variants",
      "requiredHostCapabilities",
    ]) &&
    typeof value.id === "string" &&
    typeof value.evalFingerprint === "string" &&
    isStringRecord(value.cases) &&
    isStringRecord(value.variants) &&
    Array.isArray(value.requiredHostCapabilities) &&
    value.requiredHostCapabilities.every((entry) => typeof entry === "string")
  );
}

function isStringRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
