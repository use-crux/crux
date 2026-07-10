/**
 * Turn Decision Report matchers for Quality assertions.
 *
 * These matchers let evaluations protect setup behavior that is not visible
 * in the final model output: context inclusion, routing, freshness, cache
 * acceptance, safety decisions, and the stable reason codes that explain those outcomes.
 *
 * @module
 */

import type {
  TurnDecisionReasonCode,
  TurnDisposition,
  TurnFreshnessEvidence,
} from '../observability/turn-decision-report'

/** Options shared by report matchers that assert stable reason codes. */
export interface TurnDecisionReportReasonOptions {
  /** Stable reason code from the report contract. Human reason text is ignored. */
  reasonCode?: TurnDecisionReasonCode
}

/** Matchers over context disposition rows in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportContextExpect {
  /**
   * Assert that a context reached, or was withheld from, the model with the
   * expected disposition.
   *
   * @param subject - Context id or name, such as `context:customerProfile`.
   * @param disposition - Expected report disposition.
   * @param options - Optional stable reason-code assertion.
   */
  toHaveDisposition(subject: string, disposition: TurnDisposition, options?: TurnDecisionReportReasonOptions): void
}

/** Matchers over routing decisions in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportRoutingExpect {
  /**
   * Assert that a route, tier, or routing target recorded the expected outcome.
   *
   * @param subject - Route/tier/model id or name.
   * @param outcome - Expected decision outcome, such as `selected`.
   * @param options - Optional stable reason-code assertion.
   */
  toHaveOutcome(subject: string, outcome: string, options?: TurnDecisionReportReasonOptions): void
}

/** Matchers over fallback decisions in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportFallbackExpect {
  /**
   * Assert that fallback fired for the turn.
   *
   * @param options - Optional stable reason-code assertion.
   */
  toHaveFired(options?: TurnDecisionReportReasonOptions): void
}

/** Whether freshness accepted or rejected a cache result. */
export type TurnDecisionReportCacheFreshnessAcceptance = 'accepted' | 'rejected'

/** Matchers over freshness evidence rows in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportFreshnessExpect {
  /**
   * Assert the freshness status recorded for a report subject.
   *
   * @param subject - Subject id or name.
   * @param status - Expected freshness status.
   */
  toHaveStatus(subject: string, status: TurnFreshnessEvidence['status']): void
}

/** Matchers over cache evidence rows in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportCacheExpect {
  /**
   * Assert whether freshness accepted or rejected a cache result.
   *
   * @param subject - Subject id or name.
   * @param acceptance - Expected freshness gate outcome for the cache row.
   * @param options - Optional stable reason-code assertion.
   */
  toHaveFreshnessAcceptance(
    subject: string,
    acceptance: TurnDecisionReportCacheFreshnessAcceptance,
    options?: TurnDecisionReportReasonOptions,
  ): void
}

/** Matchers over Safety decision rows in a captured `TurnDecisionReport`. */
export interface TurnDecisionReportSafetyExpect {
  /**
   * Assert that a guardrail, constraint, or tool policy recorded the expected outcome.
   *
   * @param policyId - Stable safety policy id.
   * @param outcome - Expected decision outcome, such as `block`, `rewrite`, or `request_approval`.
   * @param options - Optional stable reason-code assertion.
   */
  toHaveOutcome(policyId: string, outcome: string, options?: TurnDecisionReportReasonOptions): void
}

/** Assertion namespace for captured `TurnDecisionReport` rows. */
export interface TurnDecisionReportExpect {
  /** Context inclusion, checked, dropped, and disabled behavior. */
  context: TurnDecisionReportContextExpect
  /** Route, cascade, and selected-model behavior. */
  routing: TurnDecisionReportRoutingExpect
  /** Recovery behavior after a failed or skipped primary attempt. */
  fallback: TurnDecisionReportFallbackExpect
  /** Freshness policy evidence for contexts, retrieval, memory, and cache rows. */
  freshness: TurnDecisionReportFreshnessExpect
  /** Cache reuse/write evidence and its explicit freshness gate outcome. */
  cache: TurnDecisionReportCacheExpect
  /** Guardrail, constraint, and tool-policy decisions. */
  safety: TurnDecisionReportSafetyExpect
}
