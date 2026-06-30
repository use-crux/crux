import type { TurnCacheEvidence, TurnFreshnessEvidence } from "./evidence";
import type {
  TurnDecisionLiteral,
  TurnDecisionReason,
  TurnDisposition,
  TurnEvidenceLevel,
  TurnSourceStatus,
} from "./shared";
import type { TurnSourceJoin } from "./source-coverage";
import type { TurnDeepTabTarget } from "./targets";

/** Metadata for the generation turn being explained. */
export interface TurnDecisionTurn {
  id: string;
  kind: TurnDecisionLiteral<"generation.call" | "generation.stream">;
  name?: string;
  model?: string;
  provider?: string;
  status?: string;
  finishReason?: string;
  durMs?: number;
  ttftMs?: number;
  tokens?: { input?: number; output?: number; total?: number };
  cost?: { totalUsd?: number; inputUsd?: number; outputUsd?: number };
  /** Short deterministic sentence composed only from report facts. */
  verdict?: string;
}

/** Item that reached the model prompt or tool surface. */
export interface TurnSawItem {
  kind: TurnDecisionLiteral<
    "prompt" | "message" | "context" | "retrieval" | "memory" | "tool"
  >;
  name?: string;
  id?: string;
  disposition: "active";
  tokens?: number;
  freshness?: TurnFreshnessEvidence;
  cache?: TurnCacheEvidence;
  evidenceLevel: TurnEvidenceLevel;
  sourceStatus: TurnSourceStatus;
  source?: TurnSourceJoin;
  tab?: TurnDeepTabTarget;
}

/** Item Crux evaluated but did not send to the model. */
export interface TurnConsideredItem {
  kind: TurnDecisionLiteral<"context" | "retrieval" | "memory" | "tool">;
  name?: string;
  id?: string;
  disposition: Exclude<TurnDisposition, "active">;
  reasonState?: TurnDecisionLiteral<
    | "predicate-false"
    | "match-no-case"
    | "budget"
    | "compaction"
    | "stale-rejected"
    | "disabled"
    | "empty"
    | "unknown"
  >;
  reason?: TurnDecisionReason;
  tokens?: number;
  freshness?: TurnFreshnessEvidence;
  cache?: TurnCacheEvidence;
  evidenceLevel: TurnEvidenceLevel;
  sourceStatus: TurnSourceStatus;
  source?: TurnSourceJoin;
  required?: boolean;
  tab?: TurnDeepTabTarget;
}
