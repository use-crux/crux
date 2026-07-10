/**
 * Shared vocabulary for the Turn Decision Report contract.
 *
 * These types are intentionally small and string-based so projections, quality
 * matchers, and Devtools UI code can agree on stable machine values while
 * keeping human copy free to improve.
 */

/** Keeps known string literals visible in editors while allowing extensions. */
export type TurnDecisionLiteral<TKnown extends string> =
  | TKnown
  | (string & Record<never, never>);

/** Honesty signal for rows projected from recorded evidence. */
export type TurnEvidenceLevel =
  | "declared"
  | "observed"
  | "inferred"
  | "missing";

/** Resolution state vocabulary reused by explanation rows. */
export type TurnDisposition =
  | "active"
  | "checked"
  | "dropped"
  | "disabled"
  | "unknown";

/** Source-code join status for a report item or decision. */
export type TurnSourceStatus =
  | "used"
  | "checked"
  | "dropped"
  | "decision-only"
  | "unresolved"
  | "unknown";

/** Stable reason codes used by quality matchers and projections. */
export type TurnDecisionReasonCode =
  | "context.active"
  | "context.checked"
  | "context.disabled"
  | "context.dropped.token_budget"
  | "context.excluded.when_false"
  | "context.excluded.match_no_case"
  | "context.freshness.stale_rejected"
  | "context.freshness.stale_used"
  | "context.cache.hit"
  | "context.cache.miss"
  | "budget.applied"
  | "budget.not_configured"
  | "tool.eligible.request"
  | "tool.eligible.context_injection"
  | "tool.called"
  | "tool.result"
  | "routing.router.selected"
  | "routing.router.default_route"
  | "routing.router.forced_route"
  | "routing.cascade.tier_accepted"
  | "routing.cascade.tier_rejected"
  | "routing.cascade.tier_skipped"
  | "routing.fallback.attempt_started"
  | "routing.fallback.attempt_failed"
  | "routing.fallback.attempt_succeeded"
  | "routing.fallback.fired"
  | "guardrail.passed"
  | "guardrail.warned"
  | "guardrail.blocked"
  | "guardrail.redacted"
  | "constraint.passed"
  | "constraint.failed"
  | "constraint.retry_requested"
  | "security.passed"
  | "security.warned"
  | "security.blocked"
  | "security.redacted"
  | "cache.hit"
  | "cache.miss"
  | "cache.write"
  | "cache.mixed"
  | "cache.freshness.accepted"
  | "cache.freshness.rejected"
  | "compaction.applied"
  | "compaction.skipped"
  | "retrieval.returned_hits"
  | "retrieval.returned_empty"
  | "memory.recalled"
  | "memory.written"
  | "memory.updated"
  | "reason.missing"
  | `custom.${string}`
  | `unknown.${string}`;

/** Where a reason came from, mapped to the evidence level allowed for it. */
export type TurnDecisionReasonSource =
  | "artifact"
  | "span-attribute"
  | "event"
  | "edge"
  | "projection"
  | "not-recorded";

interface TurnDecisionReasonBase {
  /** Stable machine-readable code. UI copy must not depend on this text. */
  code: TurnDecisionReasonCode;
  /** Human-readable explanation derived from the evidence source. */
  text: string;
}

/** Reason object with source-to-evidence-level mapping enforced by TypeScript. */
export type TurnDecisionReason =
  | (TurnDecisionReasonBase & {
      source: "artifact" | "event";
      evidenceLevel: "declared";
    })
  | (TurnDecisionReasonBase & {
      source: "span-attribute";
      evidenceLevel: "declared" | "observed";
    })
  | (TurnDecisionReasonBase & { source: "edge"; evidenceLevel: "observed" })
  | (TurnDecisionReasonBase & {
      source: "projection";
      evidenceLevel: "inferred";
    })
  | (TurnDecisionReasonBase & {
      source: "not-recorded";
      evidenceLevel: "missing";
    });
