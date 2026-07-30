/**
 * Runtime validation for untrusted readable evidence destinations.
 *
 * @internal
 * @module
 */

import {
  evidenceCursorInvalidError,
  evidenceInputInvalidError,
} from "./errors";
import {
  EVIDENCE_CONCLUSIONS_BY_ROLE,
  EVIDENCE_ROLES,
  type EvidenceRole,
} from "./roles";
import type {
  EvidenceDestinationInspectRequest,
  EvidenceDestinationInspectResult,
  EvidenceDestinationRoleResult,
} from "./destination";
import { validateEvidenceSubject } from "./reference-validation";
import {
  evidenceSubjectKey,
  freezeEvidenceSubject,
} from "./subjects";
import { validateDestinationConsistency } from "./destination-consistency";
import { normalizeDestinationRecordArray } from "./destination-record-validation";
const COVERAGE_STATES = new Set([
  "not-configured",
  "not-applicable",
  "not-captured",
  "redacted",
]);
const ROLE_STATES = new Set([
  "present",
  "not-yet-recorded",
  ...COVERAGE_STATES,
]);

/** Validate, detach, and freeze a destination result before merging. */
export function normalizeEvidenceDestinationResult(
  value: unknown,
  request: EvidenceDestinationInspectRequest,
): EvidenceDestinationInspectResult {
  if (!isObject(value)) throw invalidDestination("The result is not an object.");
  const subject = Reflect.get(value, "subject");
  validateEvidenceSubject(subject);
  if (evidenceSubjectKey(subject) !== evidenceSubjectKey(request.subject)) {
    throw invalidDestination("The result subject does not match the request.");
  }
  const rolesValue = Reflect.get(value, "roles");
  if (!isObject(rolesValue)) {
    throw invalidDestination("The result has no valid role map.");
  }

  const roles = Object.fromEntries(
    EVIDENCE_ROLES.map((role) => [
      role,
      normalizeRoleResult(Reflect.get(rolesValue, role), role, request),
    ]),
  ) as unknown as EvidenceDestinationInspectResult["roles"];
  validateDestinationConsistency(roles, request);
  return Object.freeze({
    subject: freezeEvidenceSubject(subject),
    roles: Object.freeze(roles),
  });
}

function normalizeRoleResult<R extends EvidenceRole>(
  value: unknown,
  role: R,
  request: EvidenceDestinationInspectRequest,
): EvidenceDestinationRoleResult<R> {
  if (
    !isObject(value) ||
    Reflect.get(value, "role") !== role ||
    typeof Reflect.get(value, "status") !== "string" ||
    !ROLE_STATES.has(Reflect.get(value, "status") as string) ||
    !Number.isSafeInteger(Reflect.get(value, "activeRecordCount")) ||
    (Reflect.get(value, "activeRecordCount") as number) < 0 ||
    typeof Reflect.get(value, "conflicting") !== "boolean" ||
    typeof Reflect.get(value, "truncated") !== "boolean"
  ) {
    throw invalidDestination(`The ${role} role aggregate is invalid.`);
  }
  const selected = request.role === undefined || request.role === role;
  const records = normalizeDestinationRecordArray(
    Reflect.get(value, "records"),
    role,
    request.subject,
    request.limit,
  );
  const rawHistory = Reflect.get(value, "history");
  const history =
    rawHistory === undefined
      ? undefined
      : normalizeDestinationRecordArray(
          rawHistory,
          role,
          request.subject,
          request.limit,
        );
  if (!selected && (records.length > 0 || history !== undefined)) {
    throw invalidDestination(
      "Only the selected destination role may hydrate records or history.",
    );
  }
  if (!request.includeHistory && history !== undefined) {
    throw invalidDestination("The destination returned unrequested history.");
  }

  const conclusion = Reflect.get(value, "conclusion");
  if (
    conclusion !== undefined &&
    !EVIDENCE_CONCLUSIONS_BY_ROLE[role].some(
      (candidate) => candidate === conclusion,
    )
  ) {
    throw invalidDestination(`The ${role} aggregate conclusion is invalid.`);
  }
  const coverage = Reflect.get(value, "coverage");
  if (
    coverage !== undefined &&
    (typeof coverage !== "string" || !COVERAGE_STATES.has(coverage))
  ) {
    throw invalidDestination(`The ${role} coverage fact is invalid.`);
  }
  const cursor = Reflect.get(value, "cursor");
  if (cursor !== undefined) {
    if (
      request.role !== role ||
      typeof cursor !== "string" ||
      cursor.length === 0 ||
      [...cursor].length > 4_096
    ) {
      throw evidenceCursorInvalidError();
    }
  }
  if (
    request.cursor !== undefined &&
    request.role === role &&
    Reflect.get(value, "truncated") !== true
  ) {
    throw invalidDestination(
      "A destination cursor page must remain marked truncated.",
    );
  }

  return Object.freeze({
    role,
    status: Reflect.get(value, "status"),
    activeRecordCount: Reflect.get(value, "activeRecordCount") as number,
    records,
    ...(history !== undefined ? { history } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(conclusion !== undefined ? { conclusion } : {}),
    conflicting: Reflect.get(value, "conflicting") as boolean,
    truncated: Reflect.get(value, "truncated") as boolean,
    ...(cursor !== undefined ? { cursor } : {}),
  }) as EvidenceDestinationRoleResult<R>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDestination(why: string) {
  return evidenceInputInvalidError(
    `The readable evidence destination returned an invalid result. ${why}`,
    "Fix the configured destination so it returns the documented bounded evidence shape.",
  );
}
