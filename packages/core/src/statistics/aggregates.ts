/** Coverage of optional provider-reported usage. */
export type StatisticsCoverage = "complete" | "partial" | "none";

/** Whether every observed identity has an explicit attribution entry. */
export type AttributionCoverage = "complete" | "truncated";

/** Optional usage reported for one sealed semantic request. */
export interface StatisticsUsageReport {
  /** Provider-reported input tokens, absent when unknown. */
  readonly inputTokens?: number;
  /** Provider-reported output tokens, absent when unknown. */
  readonly outputTokens?: number;
  /** Provider-reported total tokens, absent when unknown. */
  readonly totalTokens?: number;
  /** Provider-reported cached input tokens, absent when unknown. */
  readonly cachedInputTokens?: number;
  /** Provider-reported reasoning tokens, absent when unknown. */
  readonly reasoningTokens?: number;
  /** Versioned provider or application supplied cost, absent when unknown. */
  readonly costUsd?: number;
}

/** Usage attributed to one normalized model identity. */
export interface ModelUsageStats extends StatisticsUsageReport {
  /** Sealed semantic request plans dispatched to this model. */
  readonly calls: number;
  /** Independent availability of token and cost facts. */
  readonly coverage: {
    readonly tokens: StatisticsCoverage;
    readonly cost: StatisticsCoverage;
  };
}

/** Usage accumulated for one statistics owner. */
export interface UsageStats extends StatisticsUsageReport {
  /** Independent availability of token and cost facts. */
  readonly coverage: {
    readonly tokens: StatisticsCoverage;
    readonly cost: StatisticsCoverage;
  };
  /** Usage keyed by the first 64 normalized model identities. */
  readonly byModel: Readonly<Record<string, ModelUsageStats>>;
  /** Usage for model identities beyond the fixed attribution bound. */
  readonly otherModels?: ModelUsageStats;
  /** Whether all model identities have explicit entries. */
  readonly modelAttribution: AttributionCoverage;
}

/** Wall-clock and accumulated active/suspended timing. */
export interface TimingStats {
  /** Timestamp of the owner's first committed fact. */
  readonly startedAt: Date;
  /** Timestamp of the newest fact included in this snapshot. */
  readonly updatedAt: Date;
  /** Timestamp of committed completion, when terminal. */
  readonly completedAt?: Date;
  /** Elapsed wall time between the first and newest committed facts. */
  readonly wallTimeMs: number;
  /** Accumulated active execution time. */
  readonly activeTimeMs: number;
  /** Accumulated suspended execution time. */
  readonly suspendedTimeMs: number;
}

/** Provider-call counters accumulated for one statistics owner. */
export interface ModelCallStats {
  /** Sealed semantic request plans dispatched. */
  readonly started: number;
  /** Semantic requests completed successfully. */
  readonly succeeded: number;
  /** Semantic requests completed with failure. */
  readonly failed: number;
  /** Semantic requests cancelled. */
  readonly cancelled: number;
  /** Exact transport retries of sealed requests. */
  readonly transportRetries: number;
}

/** Tool outcomes for an owner or one normalized Tool identity. */
export interface ToolOutcomeStats {
  /** Tool calls accepted for execution. */
  readonly called: number;
  /** Tool calls completed successfully. */
  readonly succeeded: number;
  /** Tool calls completed with failure. */
  readonly failed: number;
  /** Tool calls denied before execution. */
  readonly denied: number;
  /** Tool calls cancelled. */
  readonly cancelled: number;
}

/** Tool outcomes with bounded normalized-name attribution. */
export interface ToolStats {
  /** Complete aggregate across every Tool identity. */
  readonly total: ToolOutcomeStats;
  /** Outcomes for the first 64 normalized Tool identities. */
  readonly byName: Readonly<Record<string, ToolOutcomeStats>>;
  /** Outcomes for Tool identities beyond the fixed bound. */
  readonly otherNames?: ToolOutcomeStats;
  /** Whether all Tool identities have explicit entries. */
  readonly nameAttribution: AttributionCoverage;
}

/** Nonterminal Work states represented as point-in-time gauges. */
export type WorkCurrentState = "queued" | "running" | "suspended" | "blocked";

/** Work transitions and current-state gauges for an owner or target. */
export interface WorkOutcomeStats {
  /** Accepted Work items that entered execution. */
  readonly started: number;
  /** Work items completed successfully. */
  readonly completed: number;
  /** Work items completed with failure. */
  readonly failed: number;
  /** Work items cancelled. */
  readonly cancelled: number;
  /** Work items detached from the owner. */
  readonly detached: number;
  /** Current nonterminal population at the snapshot cursor. */
  readonly current: Readonly<Record<WorkCurrentState, number>>;
}

/** Work outcomes with bounded normalized-target attribution. */
export interface WorkStats {
  /** Complete aggregate across every Work target. */
  readonly total: WorkOutcomeStats;
  /** Outcomes for the first 64 normalized target identities. */
  readonly byTarget: Readonly<Record<string, WorkOutcomeStats>>;
  /** Outcomes for target identities beyond the fixed bound. */
  readonly otherTargets?: WorkOutcomeStats;
  /** Whether all target identities have explicit entries. */
  readonly targetAttribution: AttributionCoverage;
}

/** Safe failure categories retained by statistics. */
export type FailureKind =
  | "provider"
  | "tool"
  | "work"
  | "approval"
  | "safety"
  | "validation"
  | "preparation"
  | "timeout"
  | "runtime"
  | "unknown";

/** Content-free failure counts by normalized category. */
export interface FailureStats {
  /** Failures across every category. */
  readonly total: number;
  /** Exhaustive normalized-category counts. */
  readonly byKind: Readonly<Record<FailureKind, number>>;
}

/** Human-approval lifecycle counts. */
export interface ApprovalStats {
  /** Approval requests presented to an authority. */
  readonly requested: number;
  /** Approval requests accepted. */
  readonly approved: number;
  /** Approval requests denied. */
  readonly denied: number;
  /** Approval requests that expired without a decision. */
  readonly expired: number;
}

/** Owner lifecycle counts relevant to adaptive execution. */
export interface LifecycleStats {
  /** Owner suspensions committed. */
  readonly suspensions: number;
  /** Owner resumptions committed. */
  readonly resumptions: number;
  /** Owner cancellations committed. */
  readonly cancellations: number;
  /** Steering inputs accepted for a later semantic boundary. */
  readonly steeringInputs: number;
}

/** Session ingress outcome counters for one owner or identity. */
export interface SessionInputOutcomeStats {
  /** Newly accepted ingress identities. */
  readonly accepted: number;
  /** Replays skipped by stable delivery/input identity. */
  readonly deduplicated: number;
  /** Inputs that became model-visible at a safe boundary. */
  readonly delivered: number;
  /** Inputs that reserved activation from a parked Session. */
  readonly resumed: number;
  /** Inputs rejected before acceptance (closed, invalid, etc.). */
  readonly dropped: number;
}

/**
 * Bounded Session ingress aggregates with first-64 identity attribution.
 *
 * @remarks Totals are exact. `byIdentity` retains at most the first 64 distinct
 * identities; later identities roll into `otherIdentities` with truncated
 * attribution.
 */
export interface SessionInputStats {
  /** Exact totals across every ingress identity. */
  readonly total: SessionInputOutcomeStats;
  /** Outcomes for the first 64 normalized ingress identities. */
  readonly byIdentity: Readonly<Record<string, SessionInputOutcomeStats>>;
  /** Outcomes for identities beyond the fixed attribution bound. */
  readonly otherIdentities?: SessionInputOutcomeStats;
  /** Whether all ingress identities have explicit entries. */
  readonly identityAttribution: AttributionCoverage;
}

/** Complete mechanical aggregate for one statistics owner. */
export interface ScopeStats {
  /** Provider-reported usage and bounded model attribution. */
  readonly usage: UsageStats;
  /** Wall-clock and accumulated execution timing. */
  readonly timing: TimingStats;
  /** Semantic model-call and exact transport-retry counts. */
  readonly modelCalls: ModelCallStats;
  /** Tool outcomes and bounded name attribution. */
  readonly tools: ToolStats;
  /** Child Work outcomes, gauges, and bounded target attribution. */
  readonly work: WorkStats;
  /** Failures by safe normalized category. */
  readonly failures: FailureStats;
  /** Human-approval lifecycle counts. */
  readonly approvals: ApprovalStats;
  /** Suspension, resumption, cancellation, and steering counts. */
  readonly lifecycle: LifecycleStats;
  /** Session ingress outcomes with bounded identity attribution. */
  readonly inputs: SessionInputStats;
}
