/**
 * User-visible execution-evidence diagnostics that require documentation.
 *
 * `surface` distinguishes synchronous Core errors, inspection responses, and
 * asynchronous Local delivery dispositions. Aggregate-only health signals are
 * documented in the evidence guide and deliberately have no error page.
 */
export const evidenceErrorRegistry = Object.freeze([
  ["EVIDENCE_INPUT_INVALID", "authoring/query", false],
  ["EVIDENCE_SUBJECT_REQUIRED", "authoring", false],
  ["EVIDENCE_SUBJECT_NOT_FOUND", "query", false],
  ["EVIDENCE_KIND_INVALID", "authoring", false],
  ["EVIDENCE_CONCLUSION_INVALID", "authoring", false],
  ["EVIDENCE_REFERENCE_INVALID", "authoring", false],
  ["EVIDENCE_SUPERSESSION_INVALID", "authoring", false],
  ["EVIDENCE_IDEMPOTENCY_CONFLICT", "authoring/delivery", false],
  ["EVIDENCE_WRITE_QUARANTINED", "authoring", false],
  ["EVIDENCE_QUERY_UNAVAILABLE", "query", true],
  ["EVIDENCE_CURSOR_INVALID", "query", false],
  ["EVIDENCE_ACCESS_DENIED", "query", false],
  ["EVIDENCE_INPUT_TOO_LARGE", "query", false],
  ["EVIDENCE_QUERY_FAILED", "query", true],
  ["EVIDENCE_STAGING_CAPACITY", "delivery", true],
  ["EVIDENCE_STAGING_CANDIDATE_TOO_LARGE", "delivery", false],
  ["EVIDENCE_PRIVACY_DELETED", "delivery", false],
].map(([code, surface, retryable]) =>
  Object.freeze({ code, surface, retryable }),
));

export const evidenceAggregateHealthCodes = Object.freeze([
  "EVIDENCE_COVERAGE_CONFLICT",
  "EVIDENCE_STAGING_EXPIRED",
  "EVIDENCE_STAGING_UNPROMOTABLE",
]);
