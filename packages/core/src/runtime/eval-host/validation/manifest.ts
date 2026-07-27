import {
  CRUX_EVAL_HOST_PROTOCOL_V1,
  CRUX_EVAL_HOST_PROTOCOL_V2,
  type EvalHostManifest,
  type EvalHostManifestV1,
  type EvalHostManifestV2,
} from "../types";
import { hasExactKeys, isRecord } from "./common";

/** Validate an authenticated legacy V1 manifest. */
export function decodeEvalHostManifestV1(value: unknown): EvalHostManifestV1 {
  return decodeManifest(value, CRUX_EVAL_HOST_PROTOCOL_V1);
}

/** Validate an authenticated current V2 manifest. */
export function decodeEvalHostManifestV2(value: unknown): EvalHostManifestV2 {
  return decodeManifest(value, CRUX_EVAL_HOST_PROTOCOL_V2);
}

/** Decode a strict known manifest version before coordinator preflight. */
export function decodeEvalHostManifest(value: unknown): EvalHostManifest {
  if (isRecord(value) && value.protocol === CRUX_EVAL_HOST_PROTOCOL_V1) {
    return decodeEvalHostManifestV1(value);
  }
  return decodeEvalHostManifestV2(value);
}

function decodeManifest<
  TProtocol extends
    | typeof CRUX_EVAL_HOST_PROTOCOL_V1
    | typeof CRUX_EVAL_HOST_PROTOCOL_V2,
>(
  value: unknown,
  protocol: TProtocol,
): TProtocol extends typeof CRUX_EVAL_HOST_PROTOCOL_V1
  ? EvalHostManifestV1
  : EvalHostManifestV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocol",
      "deploymentId",
      "hostKind",
      "privacyFingerprint",
      "capabilities",
      "resultMaxBytes",
      "evals",
    ]) ||
    value.protocol !== protocol ||
    typeof value.deploymentId !== "string" ||
    !isFingerprint(value.privacyFingerprint) ||
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
    throw new EvalHostManifestCompatibilityError();
  }
  return value as never;
}

/** Authenticated manifest bytes that do not satisfy a known exact protocol. */
export class EvalHostManifestCompatibilityError extends TypeError {
  override readonly name = "EvalHostManifestCompatibilityError";

  constructor() {
    super("Eval host returned an incompatible manifest protocol.");
  }
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

function isFingerprint(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
