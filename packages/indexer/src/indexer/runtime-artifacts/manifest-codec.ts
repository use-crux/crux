import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";

export class RuntimeArtifactManifestDecodeError extends Error {
  override readonly name = "RuntimeArtifactManifestDecodeError";

  constructor(
    readonly code: "version_incompatible" | "manifest_invalid",
    message: string,
    readonly version?: unknown,
  ) {
    super(message);
  }
}

/** Exact decoder for the local Runtime artifact manifest v3 contract. */
export function decodeRuntimeArtifactManifest(
  value: unknown,
): RuntimeArtifactManifest {
  if (!isRecord(value) || value.version !== 3) {
    throw new RuntimeArtifactManifestDecodeError(
      "version_incompatible",
      "Runtime artifact manifest version is not supported.",
      isRecord(value) ? value.version : undefined,
    );
  }
  if (
    !hasExactKeys(value, [
      "version",
      "evalPrivacyFingerprint",
      "targets",
      "effectTargets",
      "evals",
    ]) ||
    typeof value.evalPrivacyFingerprint !== "string" ||
    !Array.isArray(value.targets) ||
    !value.targets.every(isTarget) ||
    !Array.isArray(value.effectTargets) ||
    !value.effectTargets.every(isEffectTarget) ||
    !Array.isArray(value.evals) ||
    !value.evals.every(isEval)
  ) {
    invalid();
  }
  return value as unknown as RuntimeArtifactManifest;
}

function isEffectTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "version", "module", "export"]) &&
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    Number.isFinite(value.version) &&
    typeof value.module === "string" &&
    typeof value.export === "string"
  );
}

function isTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["name", "kind", "module", "export"]) &&
    typeof value.name === "string" &&
    ["flow", "task", "watcher", "trigger"].includes(String(value.kind)) &&
    typeof value.module === "string" &&
    typeof value.export === "string"
  );
}

function isEval(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "module",
      "export",
      "evalFingerprint",
      "cases",
      "variants",
      "requiredHostCapabilities",
    ]) &&
    typeof value.id === "string" &&
    typeof value.module === "string" &&
    value.export === "default" &&
    typeof value.evalFingerprint === "string" &&
    Array.isArray(value.cases) &&
    value.cases.every(isCase) &&
    Array.isArray(value.variants) &&
    value.variants.every(isVariant) &&
    isStringArray(value.requiredHostCapabilities)
  );
}

function isCase(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "fingerprint"]) &&
    typeof value.id === "string" &&
    typeof value.fingerprint === "string"
  );
}

function isVariant(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "name",
      "fingerprint",
      "execution",
      "requiredHostCapabilities",
    ]) &&
    typeof value.name === "string" &&
    typeof value.fingerprint === "string" &&
    (value.execution === "coordinator" || value.execution === "runtime") &&
    isStringArray(value.requiredHostCapabilities)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCodepoint);
  const sortedExpected = [...expected].sort(compareCodepoint);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  throw new RuntimeArtifactManifestDecodeError(
    "manifest_invalid",
    "Runtime artifact manifest does not match schema version 3.",
  );
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
