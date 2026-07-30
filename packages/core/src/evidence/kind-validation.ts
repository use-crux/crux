import { CRUX_CANONICAL_ARTIFACT_KINDS } from "../observability/contract";
import { evidenceKindInvalidError } from "./errors";

/** Validate the application-owned kind required for inline evidence. @internal */
export function validateCustomEvidenceKind(value: unknown): void {
  if (!isValidCustomEvidenceKind(value)) {
    throw evidenceKindInvalidError(
      "Inline evidence requires a valid custom.* kind of at most 128 characters.",
    );
  }
}

/** Validate an explicit kind attached to an existing source. @internal */
export function validateReferencedEvidenceKind(value: unknown): void {
  if (isValidReferencedEvidenceKind(value)) return;
  throw evidenceKindInvalidError(
    "The explicit referenced-source kind is not canonical or a valid custom.* kind.",
  );
}

/** Test a kind without throwing while validating nested records. @internal */
export function isValidReferencedEvidenceKind(
  value: unknown,
): value is string {
  return (
    (typeof value === "string" &&
      CRUX_CANONICAL_ARTIFACT_KINDS.some((kind) => kind === value)) ||
    isValidCustomEvidenceKind(value)
  );
}

/** Test the shared bounded application-owned evidence-kind grammar. @internal */
export function isValidCustomEvidenceKind(
  value: unknown,
): value is `custom.${string}` {
  return (
    typeof value === "string" &&
    value.startsWith("custom.") &&
    value.length > "custom.".length &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.startsWith("custom.crux.") &&
    [...value].length <= 128
  );
}
