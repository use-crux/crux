import type {
  IndexFactKind,
  IndexRuleBudget,
  IndexRuleFidelity,
  IndexRulePhase,
} from "./rule-manifest";
import type { SourceLocation } from "./source";

export type CruxLintCategory =
  | "contracts"
  | "observability"
  | "evals"
  | "safety"
  | "memory"
  | "runtime"
  | "composition"
  | "quality";

export type CruxLintMaturity = "stable" | "preview" | "experimental";

export type CruxLintConfidence = "high" | "medium" | "low";

export type CruxLintProfile = "recommended" | "strict" | "experimental";

export type CruxLintSelectedProfile = "off" | CruxLintProfile;

export interface CruxLintRuleConfig {
  /** Disable a rule for this project. Prefer source suppressions for one-off exceptions. */
  enabled?: boolean;
  /** Override a rule's displayed severity for this project. */
  severity?: IndexLintFinding["severity"];
}

export interface CruxLintConfig {
  /** Which rule profile the dev server and index health views should expose. @default 'recommended' */
  profile?: CruxLintSelectedProfile;
  /** Project-level rule overrides keyed by rule id. */
  rules?: Record<string, CruxLintRuleConfig>;
}

export interface IndexLintEvidence {
  kind: "definition" | "relation" | "quality" | "runtime" | "source";
  label: string;
  description?: string;
  definitionId?: string;
  relationId?: string;
  source?: SourceLocation;
  data?: Record<string, unknown>;
}

export interface IndexLintFix {
  title: string;
  description: string;
  kind: "manual" | "docs" | "config" | "suppress" | "code-action";
  docsUrl?: string;
  command?: string;
  suppression?: string;
}

/** Source range affected by a matched lint suppression directive. */
export type IndexLintSuppressionScope = "next-line" | "line" | "file";

/** Evidence identifying the matched source directive, not the finding source. */
export interface IndexLintSuppressedBy {
  /** The suppression directive location, which can differ from the finding source. */
  source: SourceLocation;
  /** The exact source range selected by the directive. */
  scope: IndexLintSuppressionScope;
  /** Optional authored reason, trimmed while the directive is parsed. */
  reason?: string;
}

interface IndexLintFindingBase {
  id: string;
  severity: "info" | "warning" | "error";
  ruleId: string;
  category: CruxLintCategory;
  maturity: CruxLintMaturity;
  confidence: CruxLintConfidence;
  profiles: CruxLintProfile[];
  title: string;
  message: string;
  rationale: string;
  impact?: string;
  source?: SourceLocation;
  primaryDefinitionId?: string;
  relatedDefinitionIds: string[];
  affectedDefinitionIds?: string[];
  evidence: IndexLintEvidence[];
  fixes: IndexLintFix[];
  docsUrl: string;
  /**
   * Rule-authored capability for offering a suppression action.
   *
   * This describes what a client may offer; it does not mean the finding was
   * suppressed. Narrow on `suppressed` to read applied `suppressedBy` evidence.
   */
  suppression?: {
    /** Whether this rule permits an authored source suppression. */
    supported: boolean;
    /** Ready-to-insert directive text for this finding. */
    directive: string;
    /** Source range that the offered directive targets. */
    scope: IndexLintSuppressionScope;
  };
  propagatedDefinitionIds?: string[];
  propagationPaths?: Array<{
    fromDefinitionId: string;
    toDefinitionId: string;
    relationTypes: string[];
  }>;
}

type ActiveIndexLintFinding = IndexLintFindingBase & {
  /**
   * Whether this finding was suppressed by an authored source directive.
   *
   * Active findings omit this field in canonical JSON. `false` is accepted for
   * ergonomic authored values.
   *
   * @default false
   */
  suppressed?: false;
  /** Present only when `suppressed` is `true`. */
  suppressedBy?: never;
};

type SuppressedIndexLintFinding = IndexLintFindingBase & {
  /** `true` when a source suppression directive matched this finding. */
  suppressed: true;
  /** Directive evidence responsible for the suppressed state. */
  suppressedBy: IndexLintSuppressedBy;
};

/**
 * A materialized authored-graph lint finding.
 *
 * Suppression is retained as evidence. Narrow on `suppressed` before reading
 * `suppressedBy`; presentation surfaces may hide suppressed findings by
 * default, but stores and transport snapshots retain them.
 *
 * @example
 * ```ts
 * function suppressionReason(finding: IndexLintFinding) {
 *   if (!finding.suppressed) return undefined
 *   return finding.suppressedBy.reason
 * }
 * ```
 */
export type IndexLintFinding =
  | ActiveIndexLintFinding
  | SuppressedIndexLintFinding;

export type AnalysisTier = "syntax" | "index" | "semantic";

export interface IndexRuleDescriptor {
  id: string;
  source: "builtin" | "extension";
  extension?: { name: string; version?: string };
  severity?: IndexLintFinding["severity"];
  category?: CruxLintCategory;
  maturity?: CruxLintMaturity;
  confidence?: CruxLintConfidence;
  profiles?: CruxLintProfile[];
  title: string;
  description: string;
  rationale?: string;
  impact?: string;
  docsUrl?: string;
  fixes?: IndexLintFix[];
  /**
   * Source-suppression capability declared by the rule.
   *
   * This is rule metadata, not evidence that any finding was suppressed.
   */
  suppression?: {
    /** Whether the rule accepts authored source suppressions. */
    supported: boolean;
    /** Source range supported by the rule's suppression directive. */
    scope: IndexLintSuppressionScope;
    /** Optional directive template clients can present to users. */
    directive?: string;
  };
  phase?: IndexRulePhase;
  requires?: IndexFactKind[];
  fidelity?: IndexRuleFidelity;
  optionSchema?: unknown;
  messageIds?: string[];
  defaultOptions?: unknown;
  budget?: IndexRuleBudget;
}
