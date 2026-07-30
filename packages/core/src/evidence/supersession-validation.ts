import { evidenceSupersessionInvalidError } from "./errors";
import { isValidReferencedEvidenceKind } from "./kind-validation";
import {
  EVIDENCE_ROLES,
  type EvidenceRole,
} from "./roles";
import type { EvidenceRef } from "./record-types";
import { validateEvidenceSubject } from "./reference-validation";
import {
  evidenceSubjectKey,
  freezeEvidenceSubject,
  type EvidenceSubject,
} from "./subjects";

/** Validate syntactically available supersession refs before resolution. @internal */
export function validateEvidenceSupersedesInput(value: unknown): void {
  if (value === undefined) return;
  const refs = Array.isArray(value) ? value : [value];
  const ids = new Set<string>();

  for (const ref of refs) {
    validateEvidenceRef(ref);
    const id = Reflect.get(ref, "id") as string;
    if (ids.has(id)) {
      throw evidenceSupersessionInvalidError(
        "The supersession list contains the same evidence reference more than once.",
      );
    }
    ids.add(id);
  }
}

/** Normalize validated refs and enforce current subject/role correlation. @internal */
export function normalizeEvidenceSupersedes<R extends EvidenceRole>(
  value: EvidenceRef<R> | readonly EvidenceRef<R>[] | undefined,
  subject: EvidenceSubject,
  role: R,
): readonly EvidenceRef<R>[] {
  const refs = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const subjectKey = evidenceSubjectKey(subject);

  return Object.freeze(
    refs.map((ref) => {
      if (
        ref.role !== role ||
        evidenceSubjectKey(ref.subject) !== subjectKey
      ) {
        throw evidenceSupersessionInvalidError(
          "Every superseded reference must have the current subject and role.",
        );
      }
      return Object.freeze({
        ...ref,
        subject: freezeEvidenceSubject(ref.subject),
      });
    }),
  );
}

function validateEvidenceRef(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformedSupersessionError();
  }

  try {
    validateEvidenceSubject(Reflect.get(value, "subject"));
  } catch {
    throw malformedSupersessionError();
  }

  const role = Reflect.get(value, "role");
  if (
    Reflect.get(value, "kind") !== "execution.evidence" ||
    !isEvidenceId(Reflect.get(value, "id")) ||
    !EVIDENCE_ROLES.some((candidate) => candidate === role) ||
    !isValidReferencedEvidenceKind(Reflect.get(value, "evidenceKind")) ||
    !isTimestamp(Reflect.get(value, "recordedAt"))
  ) {
    throw malformedSupersessionError();
  }
}

function isEvidenceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^evidence_[0-9a-f]{16,64}$/u.test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function malformedSupersessionError(): ReturnType<
  typeof evidenceSupersessionInvalidError
> {
  return evidenceSupersessionInvalidError(
    "A superseded value is not a valid evidence reference.",
  );
}
