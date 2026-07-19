import type { TurnCacheEvidence, TurnFreshnessEvidence } from "./evidence";
import type {
  TurnConsideredItem,
  TurnDecisionTurn,
  TurnSawItem,
} from "./items";
import type { TurnDecisionReason } from "./shared";
import type {
  TurnCoverageArea,
  TurnDecisionChip,
  TurnDecisionCoverage,
  TurnDecisionDiagnostic,
  TurnSourceGroup,
  TurnSourceJoin,
} from "./source-coverage";
import type {
  TurnDecisionMetrics,
  TurnDecisionSubject,
  TurnDeepTabTarget,
  TurnEvidenceRef,
} from "./targets";
import type { MediaPartLocation } from "../../safety/media/types";

/** One canonical explanation report for a model call or stream turn. */
export interface TurnDecisionReport {
  /** Schema version for this public read-model contract. */
  schemaVersion: 1;
  /** Deterministic id, normally `tdr:${runId}:${generationTurnId}`. */
  reportId: string;
  /** Run id shared by all turn reports in the same run. */
  runId: string;
  /** Trace id when the report is joined to a trace. */
  traceId?: string;
  /** Generation turn metadata and deterministic readout. */
  turn: TurnDecisionTurn;
  /** Items that reached the model. */
  saw: TurnSawItem[];
  /** Items Crux checked but did not send to the model. */
  considered: TurnConsideredItem[];
  /** Evidence about whether data was current enough for the turn. */
  freshness: TurnFreshnessEvidence[];
  /** Evidence about reuse, cache writes, and provider token caching. */
  cache: TurnCacheEvidence[];
  /** Decision rows that shaped the turn. */
  decisions: TurnDecision[];
  /** Source definitions users can inspect or change. */
  source: TurnSourceGroup[];
  /** Eval coverage scorecard for the behavior. */
  coverage: TurnDecisionCoverage;
  /** Missing or degraded evidence that affects report confidence. */
  gaps: TurnDecisionDiagnostic[];
  /** Optional stable chips for scan/filter UI. */
  chips?: TurnDecisionChip[];
}

/** Phase grouping used by the Decisions section. */
export type TurnDecisionPhase =
  | "request"
  | "model-selection"
  | "checks"
  | "tool-use"
  | "data"
  | "recovery"
  | "efficiency";

/** Decision row that shaped the call. */
export interface TurnDecision {
  id: string;
  phase: TurnDecisionPhase;
  kind: string;
  subject: TurnDecisionSubject;
  outcome: string;
  reason: TurnDecisionReason;
  /** Safe model id for this media decision, when one is known. */
  model?: string;
  /** Safe original coordinates when the decision evaluated canonical media. */
  location?: MediaPartLocation;
  /** Present only when an enforced media strip escalated to a terminal block. */
  escalatedToBlock?: true;
  source?: TurnSourceJoin;
  coverage?: TurnCoverageArea;
  tab?: TurnDeepTabTarget;
  evidence?: TurnEvidenceRef[];
  freshness?: TurnFreshnessEvidence;
  cache?: TurnCacheEvidence;
  metrics?: TurnDecisionMetrics;
}
