/** Internal assertion ledger shapes persisted with Eval cell evidence. */

export type CellAssertionPhase = "expect" | "afterScores";
export type CellAssertionStatus =
  | "passed"
  | "failed"
  | "not-evaluated"
  | "uncaptured";

export interface CellAssertionValue {
  readonly label: string;
  readonly value: unknown;
  readonly preview: string;
  readonly redacted: boolean;
}

export type CellAssertionExpressionOperator =
  | ">="
  | ">"
  | "<="
  | "<"
  | "=="
  | "!="
  | "contains"
  | "matches"
  | "custom";

export interface CellAssertionExpression {
  readonly left: CellAssertionValue;
  readonly operator: CellAssertionExpressionOperator;
  readonly right?: CellAssertionValue;
  readonly result: boolean;
  readonly rendered: string;
}

export interface CellAssertionOutcome {
  readonly id: string;
  readonly level: "eval" | "case";
  readonly phase: CellAssertionPhase;
  readonly index: number;
  readonly status: CellAssertionStatus;
  readonly matcher: string;
  readonly soft: boolean;
  readonly message?: string;
  readonly subjectExpr?: string;
  readonly actual?: CellAssertionValue;
  readonly expected?: CellAssertionValue;
  readonly expression?: CellAssertionExpression;
  readonly sourceRef?: string;
  readonly assertionSiteId?: string;
  readonly spanIds?: readonly string[];
  readonly sourceFrame?: unknown;
}
