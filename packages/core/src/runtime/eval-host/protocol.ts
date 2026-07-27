import {
  CRUX_EVAL_HOST_PROTOCOL_V1,
  CRUX_EVAL_HOST_PROTOCOL_V2,
  type SubmitEvalJob,
  type SubmitEvalJobV1,
  type SubmitEvalJobV2,
} from "./types";

export const EVAL_HOST_MAX_BODY_BYTES = 16 * 1024;
export const EVAL_HOST_MAX_DEADLINE_HORIZON_MS = 24 * 60 * 60 * 1000;

const IDENTITY_KEYS = [
  "protocol",
  "jobId",
  "evalRunId",
  "evalId",
  "evalFingerprint",
  "caseId",
  "caseFingerprint",
  "variant",
  "variantFingerprint",
  "trial",
] as const;
const SUBMIT_V1_KEYS = [
  ...IDENTITY_KEYS,
  "deadlineAt",
] as const satisfies readonly (keyof SubmitEvalJobV1)[];
const SUBMIT_V2_KEYS = [
  ...IDENTITY_KEYS,
  "deadlineAt",
  "deadline",
] as const satisfies readonly (keyof SubmitEvalJobV2)[];

/** Decode one strict V1 submission retained for legacy host records. */
export function decodeSubmitEvalJobV1(
  text: string,
  now: Date,
): SubmitEvalJobV1 {
  const value = parseSubmit(text);
  if (
    !hasExactKeys(value, SUBMIT_V1_KEYS) ||
    value.protocol !== CRUX_EVAL_HOST_PROTOCOL_V1
  ) {
    throw protocolError("EVAL_HOST_INVALID_JOB");
  }
  assertIdentity(value);
  assertDeadline(value.deadlineAt, now);
  return Object.freeze(value as unknown as SubmitEvalJobV1);
}

/** Decode one strict V2 submission with explicit deadline provenance. */
export function decodeSubmitEvalJobV2(
  text: string,
  now: Date,
): SubmitEvalJobV2 {
  const value = parseSubmit(text);
  if (
    !hasExactKeys(value, SUBMIT_V2_KEYS) ||
    value.protocol !== CRUX_EVAL_HOST_PROTOCOL_V2 ||
    !isRecord(value.deadline) ||
    !hasExactKeys(value.deadline, ["source", "limitMs"]) ||
    (value.deadline.source !== "eval" && value.deadline.source !== "host") ||
    !isPositiveBoundedLimit(value.deadline.limitMs)
  ) {
    throw protocolError("EVAL_HOST_INVALID_JOB");
  }
  assertIdentity(value);
  assertDeadline(value.deadlineAt, now);
  return Object.freeze({
    ...value,
    deadline: Object.freeze({ ...value.deadline }),
  }) as unknown as SubmitEvalJobV2;
}

/** Decode either strict persisted protocol version without shape widening. */
export function decodeSubmitEvalJob(text: string, now: Date): SubmitEvalJob {
  const protocol = submissionProtocol(text);
  return protocol === CRUX_EVAL_HOST_PROTOCOL_V1
    ? decodeSubmitEvalJobV1(text, now)
    : decodeSubmitEvalJobV2(text, now);
}

function parseSubmit(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > EVAL_HOST_MAX_BODY_BYTES) {
    throw protocolError("EVAL_HOST_BODY_TOO_LARGE");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw protocolError("EVAL_HOST_INVALID_JSON");
  }
  if (!isRecord(value)) {
    throw protocolError("EVAL_HOST_INVALID_JOB");
  }
  return value;
}

function submissionProtocol(
  text: string,
): typeof CRUX_EVAL_HOST_PROTOCOL_V1 | typeof CRUX_EVAL_HOST_PROTOCOL_V2 {
  const value = parseSubmit(text);
  if (value.protocol === CRUX_EVAL_HOST_PROTOCOL_V1) {
    return CRUX_EVAL_HOST_PROTOCOL_V1;
  }
  if (value.protocol === CRUX_EVAL_HOST_PROTOCOL_V2) {
    return CRUX_EVAL_HOST_PROTOCOL_V2;
  }
  throw protocolError("EVAL_HOST_INVALID_JOB");
}

function assertIdentity(value: Record<string, unknown>): void {
  for (const key of IDENTITY_KEYS) {
    if (key === "trial") continue;
    if (typeof value[key] !== "string") {
      throw protocolError("EVAL_HOST_INVALID_JOB");
    }
  }
  if (
    !isBoundedId(value.jobId) ||
    !isBoundedId(value.evalRunId) ||
    !isBoundedId(value.evalId) ||
    !isBoundedId(value.caseId) ||
    !isBoundedId(value.variant) ||
    !isFingerprint(value.evalFingerprint) ||
    !isFingerprint(value.caseFingerprint) ||
    !isFingerprint(value.variantFingerprint) ||
    !Number.isSafeInteger(value.trial) ||
    (value.trial as number) < 0
  ) {
    throw protocolError("EVAL_HOST_INVALID_JOB");
  }
}

function assertDeadline(value: unknown, now: Date): void {
  if (typeof value !== "string") {
    throw protocolError("EVAL_HOST_INVALID_DEADLINE");
  }
  const deadlineAt = new Date(value);
  if (
    Number.isNaN(deadlineAt.getTime()) ||
    deadlineAt.toISOString() !== value
  ) {
    throw protocolError("EVAL_HOST_INVALID_DEADLINE");
  }
  if (deadlineAt.getTime() <= now.getTime()) {
    throw protocolError("EVAL_JOB_EXPIRED");
  }
  if (
    deadlineAt.getTime() - now.getTime() >
    EVAL_HOST_MAX_DEADLINE_HORIZON_MS
  ) {
    throw protocolError("EVAL_JOB_DEADLINE_TOO_FAR");
  }
}

function isPositiveBoundedLimit(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= EVAL_HOST_MAX_DEADLINE_HORIZON_MS
  );
}

/** Read one request body without buffering bytes beyond the protocol ceiling. */
export async function readEvalHostRequestText(
  request: Request,
): Promise<string> {
  return new TextDecoder().decode(await readEvalHostRequestBytes(request));
}

/** Read one request body as bytes without buffering beyond the protocol ceiling. */
export async function readEvalHostRequestBytes(
  request: Request,
): Promise<ArrayBuffer> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > EVAL_HOST_MAX_BODY_BYTES
  ) {
    throw protocolError("EVAL_HOST_BODY_TOO_LARGE");
  }
  if (request.body === null) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > EVAL_HOST_MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The body is already rejected; a hostile source cannot replace the
          // stable protocol error by refusing stream cancellation.
        }
        throw protocolError("EVAL_HOST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export class EvalHostProtocolError extends Error {
  override readonly name = "EvalHostProtocolError";
  constructor(readonly code: string) {
    super(messageForCode(code));
  }
}

function protocolError(code: string): EvalHostProtocolError {
  return new EvalHostProtocolError(code);
}

function messageForCode(code: string): string {
  switch (code) {
    case "EVAL_HOST_BODY_TOO_LARGE":
      return "The Eval job request exceeds the host protocol body limit.";
    case "EVAL_JOB_EXPIRED":
      return "The Eval job deadline has already elapsed.";
    case "EVAL_JOB_DEADLINE_TOO_FAR":
      return "The Eval job deadline exceeds the allowed horizon.";
    case "EVAL_HOST_INVALID_DEADLINE":
      return "The Eval job deadline must be a canonical ISO timestamp.";
    default:
      return "The Eval job request does not match a supported strict Eval host protocol.";
  }
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
