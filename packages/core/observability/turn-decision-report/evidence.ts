import type { TurnEvidenceLevel } from "./shared";
import type { TurnDecisionSubject, TurnDeepTabTarget } from "./targets";

/**
 * Freshness proof for data considered during a generation turn.
 *
 * Freshness answers whether the underlying evidence was current enough to use.
 * It is intentionally separate from cache behavior: cached data can still be
 * accepted, refreshed, used while stale, or rejected by policy.
 */
export interface TurnFreshnessEvidence {
  /** Thing whose freshness was evaluated, such as a context or retrieval row. */
  subject: TurnDecisionSubject;
  /** Policy result for the evidence used or rejected by this turn. */
  status:
    | "fresh"
    | "refreshed"
    | "stale-used"
    | "stale-rejected"
    | "unknown"
    | "not-applicable";
  /** Age of the evidence at evaluation time, in milliseconds. */
  ageMs?: number;
  /** Maximum age allowed by the recorded policy, in milliseconds. */
  maxAgeMs?: number;
  /** Timestamp for the observation or source version that was evaluated. */
  observedAt?: string;
  /** Timestamp after which the evidence should no longer be accepted. */
  validUntil?: string;
  /** Source-level version or revision used for the freshness decision. */
  sourceVersion?: string;
  /** Human-readable reason recorded with the freshness decision. */
  reason?: string;
  /** Honesty signal for whether the freshness proof was recorded or missing. */
  evidenceLevel?: TurnEvidenceLevel;
}

/**
 * Cache evidence for reuse, writes, misses, and provider cache behavior.
 *
 * Cache answers what was reused or stored for efficiency. If freshness affected
 * whether that cache result was usable, the relationship is represented only by
 * `acceptedByFreshness` or `rejectedByFreshness`.
 */
export interface TurnCacheEvidence {
  /** Thing whose cache behavior was observed. */
  subject: TurnDecisionSubject;
  /** Cache lookup or write outcome, independent from freshness status. */
  status:
    | "hit"
    | "miss"
    | "write"
    | "disabled"
    | "mixed"
    | "unknown"
    | "not-applicable";
  /** Stable cache key when it is safe and useful to expose. */
  cacheKey?: string;
  /** Age of the cache entry at lookup time, in milliseconds. */
  ageMs?: number;
  /** Time-to-live configured for the cache entry, in milliseconds. */
  ttlMs?: number;
  /** Estimated input or output tokens saved by reuse. */
  savedTokens?: number;
  /** Estimated cost saved by reuse, in US dollars. */
  savedCostUsd?: number;
  /** True when freshness evidence allowed the cached or live result. */
  acceptedByFreshness?: boolean;
  /** True when freshness evidence rejected an otherwise reusable cache result. */
  rejectedByFreshness?: boolean;
  /** Human-readable cache reason recorded with the evidence. */
  reason?: string;
  /** Honesty signal for whether cache behavior was recorded or inferred. */
  evidenceLevel?: TurnEvidenceLevel;
  /** Existing Run Detail tab target for deeper cache evidence. */
  tab?: TurnDeepTabTarget;
}
