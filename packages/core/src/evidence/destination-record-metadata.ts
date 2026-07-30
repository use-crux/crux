/**
 * Strict destination-derived evidence record metadata.
 *
 * @internal
 * @module
 */

import type { CruxRunId, CruxSpanId } from "../observability/contract";
import { evidenceInputInvalidError } from "./errors";
import type {
  EvidenceAcceptedAfterTerminal,
  EvidencePayloadState,
  EvidencePayloadUnavailableReason,
} from "./record-types";
import type { EvidenceSubject } from "./subjects";

const PAYLOAD_UNAVAILABLE_REASONS = new Set<EvidencePayloadUnavailableReason>([
  "policy",
  "retention",
  "access",
]);

/** Validate optional unavailability metadata against its payload state. */
export function normalizePayloadUnavailableReason(
  value: unknown,
  payloadState: EvidencePayloadState,
): EvidencePayloadUnavailableReason | undefined {
  if (value === undefined) return undefined;
  if (
    payloadState !== "redacted" ||
    typeof value !== "string" ||
    !PAYLOAD_UNAVAILABLE_REASONS.has(value as EvidencePayloadUnavailableReason)
  ) {
    throw invalidMetadata(
      "A payload-unavailable reason is invalid for its payload state.",
    );
  }
  return value as EvidencePayloadUnavailableReason;
}

/** Validate, detach, and freeze destination-proven terminal ordering. */
export function normalizeAcceptedAfterTerminal(
  value: unknown,
  subject: EvidenceSubject,
): EvidenceAcceptedAfterTerminal | undefined {
  if (value === undefined) return undefined;
  if (
    !isExactObject(value, ["judgedAgainst"]) ||
    subject.kind !== "execution"
  ) {
    throw invalidMetadata(
      "Accepted-after-terminal metadata is invalid for this subject.",
    );
  }
  const judgedAgainst = Reflect.get(value, "judgedAgainst");
  if (!isExactObject(judgedAgainst, ["kind", "id"])) {
    throw invalidMetadata(
      "Accepted-after-terminal execution identity is invalid.",
    );
  }
  const kind = Reflect.get(judgedAgainst, "kind");
  const id = Reflect.get(judgedAgainst, "id");
  // This inference only normalizes the public execution subject union, whose
  // current IDs already define its run/span variant. Canonical graph producer
  // wire data always carries and validates an explicit discriminant.
  const expectedKind = subject.id.startsWith("run_") ? "run" : "span";
  if (
    (kind !== "run" && kind !== "span") ||
    kind !== expectedKind ||
    id !== subject.id
  ) {
    throw invalidMetadata(
      "Accepted-after-terminal metadata does not match its subject.",
    );
  }
  return Object.freeze({
    judgedAgainst:
      kind === "run"
        ? Object.freeze({ kind, id: id as CruxRunId })
        : Object.freeze({ kind, id: id as CruxSpanId }),
  });
}

function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function invalidMetadata(why: string) {
  return evidenceInputInvalidError(
    `The readable evidence destination returned an invalid result. ${why}`,
    "Fix the configured destination so it returns the documented bounded evidence shape.",
  );
}
