import type {
  TurnDecisionLiteral,
  TurnEvidenceLevel,
  TurnSourceStatus,
} from "./shared";
import type { TurnDecisionSubject, TurnEvidenceRef } from "./targets";

/** Group of source joins for "What source do I change?". */
export interface TurnSourceGroup {
  group: TurnDecisionLiteral<
    | "Prompt"
    | "Contexts"
    | "Retrievers"
    | "Tools"
    | "Routing"
    | "Guardrails"
    | "Constraints"
    | "Quality"
  >;
  items: TurnSourceJoin[];
}

/** Source definition joined from runtime evidence or Project Index data. */
export interface TurnSourceJoin {
  id?: string;
  kind?: string;
  name?: string;
  file?: string;
  line?: number;
  column?: number;
  status: Exclude<TurnSourceStatus, "unknown">;
  fidelity: "exact" | "runtime-join" | "source-id" | "inferred" | "unresolved";
  sourceRefs?: TurnSourceRef[];
  unresolvedReason?:
    | "anonymous"
    | "dynamic"
    | "missing-index"
    | "ambiguous"
    | "missing-runtime-join"
    | "unknown";
}

/** Specific source span that supports a source join. */
export interface TurnSourceRef {
  role?: string;
  file?: string;
  line?: number;
  column?: number;
  snippet?: string;
}

/** Coverage scorecard for quality assertions protecting this turn. */
export interface TurnDecisionCoverage {
  covered: number;
  total: number;
  areas: TurnCoverageArea[];
}

/** One area in the protection scorecard. */
export interface TurnCoverageArea {
  area: TurnDecisionLiteral<
    | "Output quality"
    | "Context inclusion"
    | "Routing/fallback"
    | "Freshness/cache acceptance"
    | "Guardrail/security"
    | "Tool use"
  >;
  status: "covered" | "partial" | "none" | "unknown";
  suggest?: string;
  cmd?: string;
  evidenceLevel?: TurnEvidenceLevel;
}

/** Missing or inferred evidence shown without severity styling. */
export interface TurnDecisionDiagnostic {
  code?: string;
  text: string;
  detail?: string;
  evidenceLevel: "missing" | "inferred";
  subject?: TurnDecisionSubject;
  evidence?: TurnEvidenceRef[];
}

/** Optional summary chip for scan and filter affordances. */
export interface TurnSummaryChip {
  id: string;
  label: string;
  tone?: "neutral" | "info" | "warning" | "danger";
  filter?: {
    target:
      | "saw"
      | "considered"
      | "freshness"
      | "cache"
      | "decisions"
      | "coverage"
      | "gaps";
    value?: string;
  };
}
