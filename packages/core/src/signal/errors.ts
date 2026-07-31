/**
 * Payload-safe public errors for Signal publication.
 *
 * @module
 */

import type { StandardSchemaV1 } from "../internal/standard-schema";

/** Stable domain code for a Signal publication failure. */
export type SignalErrorCode =
  | "invalid_payload"
  | "idempotency_conflict"
  | "publication_rejected";

/** Base error for Signal validation and publication failures. */
export class SignalError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: SignalErrorCode;

  /** Create a payload-safe Signal error. */
  constructor(code: SignalErrorCode, message: string) {
    super(message);
    this.name = "SignalError";
    this.code = code;
  }
}

/** Error returned when an authored payload fails its Signal schema. */
export class SignalValidationError extends SignalError {
  /** Deeply frozen, bounded Standard Schema issues without payload values. */
  declare readonly issues: readonly StandardSchemaV1.Issue[];

  /** Create a validation error from Standard Schema issues. */
  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super("invalid_payload", "Signal payload failed schema validation.");
    this.name = "SignalValidationError";
    Object.defineProperty(this, "issues", {
      value: snapshotValidationIssues(issues),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
}

const MAX_VALIDATION_ISSUES = 20;
const MAX_VALIDATION_PATH_SEGMENTS = 20;
type ValidationPathSegment = NonNullable<
  StandardSchemaV1.Issue["path"]
>[number];

/**
 * Copy schema issues without invoking schema-owned collection methods.
 *
 * Path snapshots retain only strings and finite numbers, either directly or
 * in a fresh `{ key }` record. Symbols and unsupported values are omitted so
 * this JSON-facing public error never retains an active schema-owned value.
 */
function snapshotValidationIssues(
  issues: readonly StandardSchemaV1.Issue[],
): readonly StandardSchemaV1.Issue[] {
  if (!Array.isArray(issues)) throw new TypeError("Invalid schema issues.");
  const snapshot: StandardSchemaV1.Issue[] = [];
  const retainedLength = boundedArrayLength(issues, MAX_VALIDATION_ISSUES);
  for (let index = 0; index < retainedLength; index += 1) {
    if (!Object.hasOwn(issues, index)) {
      throw new TypeError("Invalid sparse schema issues.");
    }
    snapshot.push(safeValidationIssue(issues[index]!));
  }
  return Object.freeze(snapshot);
}

function safeValidationIssue(
  issue: StandardSchemaV1.Issue,
): StandardSchemaV1.Issue {
  if (issue === null || typeof issue !== "object") {
    throw new TypeError("Invalid schema issue.");
  }
  const path = issue.path;
  return Object.freeze({
    message: "Signal payload did not satisfy the schema.",
    ...(path === undefined
      ? {}
      : { path: snapshotValidationPath(path) }),
  });
}

function snapshotValidationPath(
  path: readonly ValidationPathSegment[],
): NonNullable<StandardSchemaV1.Issue["path"]> {
  if (!Array.isArray(path)) throw new TypeError("Invalid schema issue path.");
  const snapshot: Array<string | number | StandardSchemaV1.PathSegment> = [];
  const retainedLength = boundedArrayLength(
    path,
    MAX_VALIDATION_PATH_SEGMENTS,
  );
  for (let index = 0; index < retainedLength; index += 1) {
    if (!Object.hasOwn(path, index)) {
      throw new TypeError("Invalid sparse schema issue path.");
    }
    const segment = safeValidationPathSegment(path[index]);
    if (segment !== undefined) snapshot.push(segment);
  }
  return Object.freeze(snapshot);
}

function safeValidationPathSegment(
  segment: unknown,
): string | number | StandardSchemaV1.PathSegment | undefined {
  const key = safeValidationPathKey(segment);
  if (key !== undefined) return key;
  if (segment === null || typeof segment !== "object") return undefined;
  const segmentKey = (segment as { readonly key?: unknown }).key;
  const retainedKey = safeValidationPathKey(segmentKey);
  return retainedKey === undefined
    ? undefined
    : Object.freeze({ key: retainedKey });
}

function safeValidationPathKey(value: unknown): string | number | undefined {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boundedArrayLength(values: readonly unknown[], limit: number): number {
  const length = values.length;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    throw new TypeError("Invalid schema array length.");
  }
  return length > limit ? limit : length;
}
