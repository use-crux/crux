import {
  evidenceConclusionInvalidError,
  evidenceCursorInvalidError,
  evidenceInputInvalidError,
} from "./errors";
import {
  validateCustomEvidenceKind,
  validateReferencedEvidenceKind,
} from "./kind-validation";
import { validateEvidenceJson } from "./json-validation";
import { validateEvidenceSubject } from "./reference-validation";
import {
  EVIDENCE_CONCLUSIONS_BY_ROLE,
  EVIDENCE_ROLES,
  type EvidenceRole,
} from "./roles";
import { validateEvidenceSupersedesInput } from "./supersession-validation";
import type { EvidenceInspectOptions } from "./view-types";

/** Validate source ownership before any subject resolution or mutation. @internal */
export function validateEvidenceRecordInput(input: unknown): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw evidenceInputInvalidError(
      "The record input is not an object.",
      "Pass an object with exactly one of inline data or an existing reference.",
    );
  }

  const hasData = Object.hasOwn(input, "data");
  const hasRef = Object.hasOwn(input, "ref");
  if (hasData === hasRef) {
    throw evidenceInputInvalidError(
      "Exactly one own property named data or ref is required.",
      "Remove one source or provide the missing source property.",
    );
  }
  if (
    (hasData && Reflect.get(input, "data") === undefined) ||
    (hasRef && Reflect.get(input, "ref") === undefined)
  ) {
    throw evidenceInputInvalidError(
      "An evidence source cannot be undefined.",
      "Provide JSON-safe inline data or a valid existing reference.",
    );
  }

  const role = Reflect.get(input, "role");
  if (!isEvidenceRole(role)) {
    throw evidenceInputInvalidError(
      "The evidence role is not one of the five supported roles.",
      "Use intent, authority, change, verification, or recovery.",
    );
  }

  const conclusion = Reflect.get(input, "conclusion");
  if (
    (role === "intent" && Object.hasOwn(input, "conclusion")) ||
    (conclusion !== undefined &&
      !EVIDENCE_CONCLUSIONS_BY_ROLE[role].some(
        (candidate) => candidate === conclusion,
      ))
  ) {
    throw evidenceConclusionInvalidError();
  }

  if (hasData) {
    validateCustomEvidenceKind(Reflect.get(input, "kind"));
    validateEvidenceJson(Reflect.get(input, "data"));
  } else {
    validateEvidenceSubject(Reflect.get(input, "ref"));
    const kind = Reflect.get(input, "kind");
    if (kind !== undefined) validateReferencedEvidenceKind(kind);
  }

  const observedAt = Reflect.get(input, "observedAt");
  if (
    observedAt !== undefined &&
    (typeof observedAt !== "string" ||
      !Number.isFinite(Date.parse(observedAt)))
  ) {
    throw evidenceInputInvalidError(
      "The observedAt value is not a valid ISO-compatible timestamp.",
      "Pass an ISO timestamp or omit observedAt.",
    );
  }

  const idempotencyKey = Reflect.get(input, "idempotencyKey");
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" ||
      idempotencyKey.length === 0 ||
      [...idempotencyKey].length > 256)
  ) {
    throw evidenceInputInvalidError(
      "The idempotency key must contain 1 to 256 characters.",
      "Pass a bounded opaque retry key or omit idempotencyKey.",
    );
  }
  validateEvidenceSupersedesInput(Reflect.get(input, "supersedes"));
}

/** Validate and detach inspect options before selecting a source. @internal */
export function normalizeEvidenceInspectOptions(
  options: unknown,
): Readonly<EvidenceInspectOptions> {
  if (options === undefined) return Object.freeze({});
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw evidenceInputInvalidError(
      "Evidence inspect options are not an object.",
      "Pass a bounded options object or omit it.",
    );
  }

  const role = Reflect.get(options, "role");
  if (role !== undefined && !isEvidenceRole(role)) {
    throw evidenceInputInvalidError(
      "The selected evidence role is not one of the five supported roles.",
      "Use intent, authority, change, verification, or recovery.",
    );
  }

  const limit = Reflect.get(options, "limit");
  if (
    limit !== undefined &&
    (typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50)
  ) {
    throw evidenceInputInvalidError(
      "Evidence inspect limit must be an integer from 1 through 50.",
      "Choose a limit within the documented range; values are never clamped.",
    );
  }

  const includeHistory = Reflect.get(options, "includeHistory");
  const includeData = Reflect.get(options, "includeData");
  if (
    (includeHistory !== undefined && typeof includeHistory !== "boolean") ||
    (includeData !== undefined && typeof includeData !== "boolean")
  ) {
    throw evidenceInputInvalidError(
      "Evidence inclusion options must be boolean values.",
      "Pass true or false for includeHistory and includeData, or omit them.",
    );
  }

  const cursor = Reflect.get(options, "cursor");
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" ||
      cursor.length === 0 ||
      [...cursor].length > 4_096 ||
      role === undefined)
  ) {
    throw evidenceCursorInvalidError();
  }

  return Object.freeze({
    ...(role !== undefined ? { role } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(includeHistory !== undefined ? { includeHistory } : {}),
    ...(includeData !== undefined ? { includeData } : {}),
  });
}

function isEvidenceRole(value: unknown): value is EvidenceRole {
  return EVIDENCE_ROLES.some((candidate) => candidate === value);
}
