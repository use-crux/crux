/**
 * Private authoring seam for explicit evidence coverage facts.
 *
 * @internal
 * @module
 */

import { activeEvidenceCollector } from "./collector";
import { observe } from "../observability";
import type { EvidenceCoverageEventAttributes } from "../observability/evidence-coverage-schema";
import {
  prepareObservabilityEvent,
  publishPreparedObservabilityBatch,
  reportPreparedObservabilityFailure,
} from "../observability/observe";
import { evidenceInputInvalidError } from "./errors";
import { EVIDENCE_ROLES, type EvidenceRole } from "./roles";
import type { EvidenceSubject } from "./subjects";
import { freezeEvidenceSubject } from "./subjects";
import { validateEvidenceSubject } from "./reference-validation";
import type { EvidenceExplicitCoverageStatus } from "./view-types";
import { resolveEvidenceGraphNode } from "./graph-identity";

/** Native producer statement about why a role has no usable relationship. */
export interface EvidenceCoverageFact<R extends EvidenceRole = EvidenceRole> {
  readonly subject: EvidenceSubject;
  readonly role: R;
  readonly status: EvidenceExplicitCoverageStatus;
  readonly observedAt?: string;
}

const EXPLICIT_COVERAGE_STATUSES = new Set<EvidenceExplicitCoverageStatus>([
  "not-configured",
  "not-applicable",
  "not-captured",
  "redacted",
]);

/**
 * Validate and append one native coverage fact to the active root.
 *
 * @param fact - Explicit non-present coverage supplied by a Core producer.
 * @throws `CruxEvidenceError` when the fact is malformed.
 * @internal
 */
export function recordEvidenceCoverageFact<R extends EvidenceRole>(
  fact: EvidenceCoverageFact<R>,
): void {
  validateCoverageFact(fact);
  const context = observe.captureContext();
  if (context?.currentSpanId === undefined) {
    throw invalidCoverageFact(
      "Evidence coverage requires an active span that made the observation.",
    );
  }
  const subject = resolveEvidenceGraphNode(fact.subject);
  const timestamp = fact.observedAt ?? new Date().toISOString();
  const attributes = Object.freeze({
    subject,
    role: fact.role,
    status: fact.status,
  }) satisfies EvidenceCoverageEventAttributes;
  const prepared = prepareObservabilityEvent(
    {
      name: "evidence.coverage",
      attributes,
    },
    timestamp,
  );
  if (
    !prepared.ok ||
    prepared.record.name !== "evidence.coverage" ||
    prepared.record.spanId !== context.currentSpanId ||
    prepared.record.timestamp !== timestamp ||
    !sameJson(prepared.record.attributes, attributes)
  ) {
    if (!prepared.ok) {
      reportPreparedObservabilityFailure(prepared);
    } else {
      reportPreparedObservabilityFailure({
        ok: false,
        reason: "redacted",
        detail: new Error(
          "Observability redaction cannot rewrite protected evidence coverage identity.",
        ),
      });
    }
    return;
  }
  const frozen = Object.freeze({
    subject: freezeEvidenceSubject(fact.subject),
    role: fact.role,
    status: fact.status,
    ...(fact.observedAt !== undefined ? { observedAt: fact.observedAt } : {}),
  }) satisfies EvidenceCoverageFact<R>;
  const conflicting =
    activeEvidenceCollector(true)?.appendCoverageFact(frozen) ?? false;
  publishPreparedObservabilityBatch([prepared.record]);
  if (conflicting) {
    observe.event({
      name: "evidence.coverage.conflict",
      attributes: { role: frozen.role },
    });
  }
}

function validateCoverageFact(
  fact: unknown,
): asserts fact is EvidenceCoverageFact {
  if (typeof fact !== "object" || fact === null || Array.isArray(fact)) {
    throw invalidCoverageFact("The coverage fact is not an object.");
  }
  if (
    Object.keys(fact).some(
      (key) =>
        key !== "subject" &&
        key !== "role" &&
        key !== "status" &&
        key !== "observedAt",
    )
  ) {
    throw invalidCoverageFact("The coverage fact contains unsupported fields.");
  }
  validateEvidenceSubject(Reflect.get(fact, "subject"));
  if (Reflect.get(Reflect.get(fact, "subject"), "kind") === "effect.receipt") {
    throw invalidCoverageFact(
      "Effect-receipt coverage is unavailable until Effects provides its canonical summary artifact.",
    );
  }
  if (!EVIDENCE_ROLES.some((role) => role === Reflect.get(fact, "role"))) {
    throw invalidCoverageFact("The coverage fact role is invalid.");
  }
  if (
    !EXPLICIT_COVERAGE_STATUSES.has(
      Reflect.get(fact, "status") as EvidenceExplicitCoverageStatus,
    )
  ) {
    throw invalidCoverageFact("The explicit coverage status is invalid.");
  }
  const observedAt = Reflect.get(fact, "observedAt");
  if (
    observedAt !== undefined &&
    (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)))
  ) {
    throw invalidCoverageFact("The coverage timestamp is invalid.");
  }
}

function invalidCoverageFact(why: string) {
  return evidenceInputInvalidError(
    why,
    "Pass a valid projectable subject, role, and explicit status from inside the observing span.",
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
