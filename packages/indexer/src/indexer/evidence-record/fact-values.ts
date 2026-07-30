import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  type CruxCanonicalArtifactKind,
} from "@use-crux/core/observability";
import type {
  EvidenceRecordConclusionFact,
  EvidenceRecordFacts,
  EvidenceRecordKindFact,
} from "@use-crux/core/project-index";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const;

const conclusions = new Set<EvidenceRecordConclusionFact>([
  "allowed",
  "denied",
  "revoked",
  "inconclusive",
  "applied",
  "partial",
  "no-change",
  "unknown",
  "passed",
  "failed",
  "available",
  "unavailable",
  "succeeded",
]);

/** Classifies a proven literal without retaining invalid authored text. */
export function evidenceKindFact(
  value: string | undefined,
): EvidenceRecordKindFact {
  if (value === undefined) return { classification: "unresolved" };
  if (isCanonicalKind(value)) {
    return { classification: "canonical", value };
  }
  if (isValidCustomKind(value)) {
    return { classification: "custom", value };
  }
  return { classification: "invalid" };
}

/** Narrows a literal role to the closed evidence vocabulary. */
export function evidenceRoleFact(
  value: string | undefined,
): EvidenceRecordFacts["role"] {
  return roles.find((role) => role === value) ?? "unresolved";
}

/** Retains only a conclusion valid for the proven role. */
export function evidenceConclusionFact(
  role: EvidenceRecordFacts["role"],
  value: string | undefined,
): EvidenceRecordConclusionFact | undefined {
  if (!value || role === "unresolved" || role === "intent") return undefined;
  if (!conclusions.has(value as EvidenceRecordConclusionFact)) return undefined;
  switch (role) {
    case "authority":
      return ["allowed", "denied", "revoked", "inconclusive"].includes(value)
        ? (value as EvidenceRecordConclusionFact)
        : undefined;
    case "change":
      return ["applied", "partial", "no-change", "unknown"].includes(value)
        ? (value as EvidenceRecordConclusionFact)
        : undefined;
    case "verification":
      return ["passed", "failed", "inconclusive"].includes(value)
        ? (value as EvidenceRecordConclusionFact)
        : undefined;
    case "recovery":
      return [
        "available",
        "unavailable",
        "succeeded",
        "failed",
        "partial",
      ].includes(value)
        ? (value as EvidenceRecordConclusionFact)
        : undefined;
    default:
      return undefined;
  }
}

function isCanonicalKind(value: string): value is CruxCanonicalArtifactKind {
  return (CRUX_CANONICAL_ARTIFACT_KINDS as readonly string[]).includes(value);
}

function isValidCustomKind(value: string): value is `custom.${string}` {
  return (
    value.startsWith("custom.") &&
    value.length > "custom.".length &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.startsWith("custom.crux.") &&
    [...value].length <= 128
  );
}
