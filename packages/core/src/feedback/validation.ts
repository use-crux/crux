import type { CruxRunId } from "../observability/contract";
import { redactSensitiveValue } from "../shared/redaction";
import type { JsonValue } from "../storage/types";
import type {
  FeedbackInput,
  FeedbackRating,
  FeedbackReceipt,
  FeedbackSubmission,
} from "./types";

const MAX_COMMENT_LENGTH = 4_000;
const MAX_DEDUPE_KEY_LENGTH = 128;
const MAX_CORRECTION_BYTES = 64 * 1_024;

/** Validate and privacy-normalize one public feedback call. @internal */
export function normalizeFeedbackSubmission(
  runId: string,
  input: FeedbackRating | FeedbackInput,
): FeedbackSubmission {
  if (!/^run_[0-9a-f]{24}$/u.test(runId)) {
    throw new TypeError("feedback() requires a valid Crux run ID.");
  }
  const value = typeof input === "string" ? { rating: input } : input;
  if (value.rating !== "up" && value.rating !== "down") {
    throw new TypeError("feedback() rating must be 'up' or 'down'.");
  }

  const comment = boundedString(value.comment, "comment", MAX_COMMENT_LENGTH);
  const dedupeKey = boundedString(
    value.dedupeKey,
    "dedupeKey",
    MAX_DEDUPE_KEY_LENGTH,
  );
  const correction = normalizeCorrection(value.correction);
  return Object.freeze({
    runId: runId as CruxRunId,
    rating: value.rating,
    ...(comment !== undefined
      ? { comment: String(redactSensitiveValue(comment)) }
      : {}),
    ...(correction !== undefined ? { correction } : {}),
    ...(dedupeKey !== undefined ? { dedupeKey } : {}),
  });
}

/** Validate and freeze the durable destination acknowledgement. @internal */
export function normalizeFeedbackReceipt(value: FeedbackReceipt): FeedbackReceipt {
  if (
    typeof value?.feedbackId !== "string" ||
    value.feedbackId.length === 0 ||
    typeof value.reviewId !== "string" ||
    value.reviewId.length === 0 ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    (value.status !== "created" &&
      value.status !== "updated" &&
      value.status !== "duplicate") ||
    typeof value.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(value.acceptedAt))
  ) {
    throw new TypeError(
      "feedback() destination returned an invalid durable receipt.",
    );
  }
  return Object.freeze({ ...value });
}

function boundedString(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(
      `feedback() ${field} must be a string of at most ${maxLength} characters.`,
    );
  }
  return value;
}

function normalizeCorrection(
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (value === undefined) return undefined;
  assertJsonValue(value, "correction", new WeakSet<object>());
  const normalized = redactSensitiveValue(value) as JsonValue;
  if (
    new TextEncoder().encode(JSON.stringify(normalized)).byteLength >
    MAX_CORRECTION_BYTES
  ) {
    throw new TypeError(
      `feedback() correction must be at most ${MAX_CORRECTION_BYTES} UTF-8 bytes.`,
    );
  }
  return normalized;
}

function assertJsonValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`feedback() ${path} must contain only JSON values.`);
  }
  if (seen.has(value)) {
    throw new TypeError(`feedback() ${path} must not contain circular values.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        assertJsonValue(entry, `${path}[${index}]`, seen),
      );
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new TypeError(`feedback() ${path}.${key} must be JSON-safe.`);
      }
      assertJsonValue(entry, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}
