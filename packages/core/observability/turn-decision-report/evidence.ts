import type { TurnEvidenceLevel } from "./shared";
import type { TurnDecisionSubject, TurnDeepTabTarget } from "./targets";

/** Whether underlying evidence was current enough for this turn. */
export interface TurnFreshnessEvidence {
  subject: TurnDecisionSubject;
  status:
    | "fresh"
    | "refreshed"
    | "stale-used"
    | "stale-rejected"
    | "unknown"
    | "not-applicable";
  ageMs?: number;
  maxAgeMs?: number;
  observedAt?: string;
  validUntil?: string;
  sourceVersion?: string;
  reason?: string;
  evidenceLevel?: TurnEvidenceLevel;
}

/** Reuse, write, or cache-miss evidence, kept separate from freshness. */
export interface TurnCacheEvidence {
  subject: TurnDecisionSubject;
  status:
    | "hit"
    | "miss"
    | "write"
    | "disabled"
    | "mixed"
    | "unknown"
    | "not-applicable";
  cacheKey?: string;
  ageMs?: number;
  ttlMs?: number;
  savedTokens?: number;
  savedCostUsd?: number;
  acceptedByFreshness?: boolean;
  rejectedByFreshness?: boolean;
  reason?: string;
  evidenceLevel?: TurnEvidenceLevel;
  tab?: TurnDeepTabTarget;
}
