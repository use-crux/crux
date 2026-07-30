/**
 * Record validation for untrusted readable evidence destinations.
 *
 * @internal
 * @module
 */

import type { JsonValue } from "../storage";
import { evidenceInputInvalidError } from "./errors";
import { EVIDENCE_CONCLUSIONS_BY_ROLE, type EvidenceRole } from "./roles";
import { validateEvidenceJson } from "./json-validation";
import type {
  EvidencePayloadState,
  EvidenceRecord,
  EvidenceRef,
} from "./record-types";
import { validateEvidenceSubject } from "./reference-validation";
import {
  normalizeEvidenceSupersedes,
  validateEvidenceSupersedesInput,
} from "./supersession-validation";
import {
  evidenceSubjectKey,
  freezeEvidenceSubject,
  type EvidenceExecutionRef,
  type EvidenceSubject,
} from "./subjects";
import {
  normalizeAcceptedAfterTerminal,
  normalizePayloadUnavailableReason,
} from "./destination-record-metadata";
import { cloneAndFreezeEvidenceJson } from "./freeze-json";

const PAYLOAD_STATES = new Set([
  "available",
  "reference",
  "redacted",
  "not-captured",
]);

/** Validate, detach, and freeze one bounded destination record page. */
export function normalizeDestinationRecordArray<R extends EvidenceRole>(
  value: unknown,
  role: R,
  subject: EvidenceSubject,
  limit: number,
): readonly EvidenceRecord<R>[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw invalidRecord("A destination record page exceeds its bound.");
  }
  return Object.freeze(
    value.map((record) => normalizeRecord(record, role, subject)),
  );
}

function normalizeRecord<R extends EvidenceRole>(
  value: unknown,
  role: R,
  subject: EvidenceSubject,
): EvidenceRecord<R> {
  if (!isObject(value)) throw invalidRecord("A record is not an object.");
  const ref = Reflect.get(value, "ref");
  validateEvidenceSupersedesInput(ref);
  if (!isObject(ref)) {
    throw invalidRecord("A record reference is invalid.");
  }
  const refSubject = Reflect.get(ref, "subject");
  validateEvidenceSubject(refSubject);
  if (
    Reflect.get(ref, "role") !== role ||
    evidenceSubjectKey(refSubject) !== evidenceSubjectKey(subject)
  ) {
    throw invalidRecord(
      "A record reference has the wrong subject or role.",
    );
  }
  const source = Reflect.get(value, "source");
  validateEvidenceSubject(source);
  const conclusion = Reflect.get(value, "conclusion");
  if (
    conclusion !== undefined &&
    !EVIDENCE_CONCLUSIONS_BY_ROLE[role].some(
      (candidate) => candidate === conclusion,
    )
  ) {
    throw invalidRecord("A record conclusion is invalid for its role.");
  }
  const supersedes = Reflect.get(value, "supersedes");
  validateEvidenceSupersedesInput(supersedes);
  const normalizedSupersedes = normalizeEvidenceSupersedes(
    supersedes as EvidenceRef<R> | readonly EvidenceRef<R>[] | undefined,
    subject,
    role,
  );
  const payloadState = Reflect.get(value, "payloadState");
  if (
    typeof payloadState !== "string" ||
    !PAYLOAD_STATES.has(payloadState)
  ) {
    throw invalidRecord("A record payload state is invalid.");
  }
  const data = Reflect.get(value, "data");
  if (data !== undefined) {
    if (payloadState !== "available") {
      throw invalidRecord("Unavailable destination evidence contains data.");
    }
    validateEvidenceJson(data);
  }
  const observedAt = optionalTimestamp(value, "observedAt");
  const producer = normalizeProducer(Reflect.get(value, "producer"));
  const payloadUnavailableReason = normalizePayloadUnavailableReason(
    Reflect.get(value, "payloadUnavailableReason"),
    payloadState as EvidencePayloadState,
  );
  const acceptedAfterTerminal = normalizeAcceptedAfterTerminal(
    Reflect.get(value, "acceptedAfterTerminal"),
    subject,
  );

  return Object.freeze({
    ref: Object.freeze({
      ...ref,
      subject: freezeEvidenceSubject(subject),
    }),
    source: freezeEvidenceSubject(source),
    ...(conclusion !== undefined ? { conclusion } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
    supersedes: normalizedSupersedes,
    ...(producer !== undefined ? { producer } : {}),
    ...(acceptedAfterTerminal !== undefined
      ? { acceptedAfterTerminal }
      : {}),
    payloadState: payloadState as EvidencePayloadState,
    ...(payloadUnavailableReason !== undefined
      ? { payloadUnavailableReason }
      : {}),
    ...(data !== undefined
      ? { data: cloneAndFreezeEvidenceJson(data as JsonValue) }
      : {}),
  }) as EvidenceRecord<R>;
}

function normalizeProducer(value: unknown): EvidenceExecutionRef | undefined {
  if (value === undefined) return undefined;
  validateEvidenceSubject(value);
  if (value.kind !== "execution") {
    throw invalidRecord("A destination producer is not an execution.");
  }
  return freezeEvidenceSubject(value) as EvidenceExecutionRef;
}

function optionalTimestamp(
  value: object,
  key: string,
): string | undefined {
  const timestamp = Reflect.get(value, key);
  if (
    timestamp !== undefined &&
    (typeof timestamp !== "string" ||
      !Number.isFinite(Date.parse(timestamp)))
  ) {
    throw invalidRecord("A destination timestamp is invalid.");
  }
  return timestamp as string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRecord(why: string) {
  return evidenceInputInvalidError(
    `The readable evidence destination returned an invalid result. ${why}`,
    "Fix the configured destination so it returns the documented bounded evidence shape.",
  );
}
