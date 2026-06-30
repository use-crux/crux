import type { TurnDecisionLiteral } from "./shared";

/** Subject that a freshness, cache, or decision row is about. */
export interface TurnDecisionSubject {
  kind: TurnDecisionLiteral<
    | "prompt"
    | "message"
    | "context"
    | "prompt-budget"
    | "tool"
    | "model"
    | "route"
    | "guardrail"
    | "constraint"
    | "security-check"
    | "cache"
    | "compaction"
    | "retrieval"
    | "memory"
    | "generation"
  >;
  id?: string;
  name?: string;
  label?: string;
}

/** Existing Run Detail tab target for an explanation row. */
export interface TurnDeepTabTarget {
  tab: TurnDecisionLiteral<
    | "Context"
    | "Routing"
    | "Guardrail"
    | "Security"
    | "Constraint"
    | "Cache"
    | "Compaction"
    | "Output"
  >;
  anchorId?: string;
  artifactId?: string;
  spanId?: string;
}

/** Small evidence pointer that keeps the report from duplicating payloads. */
export type TurnEvidenceRef =
  | { kind: "span"; spanId: string; primitive?: string; role: string }
  | {
      kind: "artifact";
      artifactId: string;
      artifactKind: string;
      spanId?: string;
      role: string;
    }
  | { kind: "event"; spanId: string; name: string; role: string }
  | {
      kind: "edge";
      edgeType: string;
      fromId?: string;
      toId?: string;
      role: string;
    };

/** Numeric measurements attached to a decision. */
export interface TurnDecisionMetrics {
  tokens?: number;
  staticTokens?: number;
  dynamicTokens?: number;
  priority?: number;
  sizeBytes?: number;
  durationMs?: number;
  costUsd?: number;
  score?: number;
  confidence?: number;
}
