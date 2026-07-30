import { evidenceReferenceInvalidError } from "./errors";
import type { EvidenceSubject } from "./subjects";

/** Validate a canonical evidence subject or source reference. @internal */
export function validateEvidenceSubject(
  value: unknown,
): asserts value is EvidenceSubject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw evidenceReferenceInvalidError();
  }

  const kind = Reflect.get(value, "kind");
  const id = Reflect.get(value, "id");
  if (kind === "execution" && isExecutionId(id)) return;
  if (
    kind === "artifact" &&
    typeof id === "string" &&
    /^artifact_(?:[0-9a-f]{16}|[0-9a-f]{64})$/u.test(id)
  ) {
    return;
  }
  if (
    kind === "effect.receipt" &&
    boundedString(id, 512) &&
    boundedString(Reflect.get(value, "effectId"), 256)
  ) {
    return;
  }
  throw evidenceReferenceInvalidError();
}

function isExecutionId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (/^run_[0-9a-f]{24}$/u.test(value) ||
      (/^[0-9a-f]{16}$/u.test(value) && !/^0+$/u.test(value)))
  );
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= maximum
  );
}
