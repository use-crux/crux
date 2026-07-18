/** Immutable cost-estimation and admission records for Eval plans. @internal */

export type EvalCostEstimate =
  | { readonly kind: "none" }
  | {
      readonly kind: "known";
      readonly maximumUsd: number;
      readonly source: "managed_metadata" | "config_override";
    }
  | {
      readonly kind: "unknown";
      readonly source: "unknown";
      readonly missingPricingKeys: readonly string[];
      readonly remedy: string;
    };

export interface EvalCostAction {
  readonly actionId: string;
  readonly kind: "task" | "scorer";
  readonly caseId: string;
  readonly variant: string;
  readonly trial: number;
  readonly scorerName?: string;
  readonly estimate: EvalCostEstimate;
}

/** Rich read-only input available only while estimating one plan action. */
export interface EvalCostEstimationRequest extends Omit<
  EvalCostAction,
  "estimate"
> {
  readonly task: unknown;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly input: unknown;
  readonly call?: Readonly<Record<string, unknown>>;
  readonly scorer?: unknown;
  /** Adapter model selected by a managed scorer, when Core can prove it. */
  readonly billingModel?: unknown;
  /** Whether a managed scorer inherits the task model when no explicit model exists. */
  readonly inheritTaskModel?: boolean;
  readonly pricing?: Readonly<
    Record<string, { readonly maxUsdPerCall: number }>
  >;
}

export type EvalCostAdmission =
  | {
      readonly status: "admitted";
      readonly costControl: "not_required" | "max_cost" | "unknown";
      readonly maxCostUsd?: number;
    }
  | {
      readonly status: "blocked";
      readonly reason:
        | "max_cost_required"
        | "unknown_cost_under_cap"
        | "max_cost_exceeded"
        | "confirmation_required"
        | "confirmation_declined";
    }
  | {
      readonly status: "confirmation_required";
      readonly reason: "unknown_cost";
    };

export interface EvalCostPlan {
  readonly actions: readonly EvalCostAction[];
  readonly knownMaximumUsd: number;
  readonly unknownActionCount: number;
  readonly admission: EvalCostAdmission;
  readonly planOnly: boolean;
}

export interface EvalCostPlanOptions {
  readonly maxCostUsd?: number;
  readonly interactive?: boolean;
  readonly plan?: boolean;
}
