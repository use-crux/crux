/** Structured strict-offline plan decisions and misses. @internal */

import type { EvalScorerAction } from "./scorer-action-types";
import type { EvalPlanAction } from "./types";

/** One external result unavailable to a strict-offline run. */
export type EvalOfflineMiss =
  | {
      readonly kind: "task";
      readonly actionId: string;
      readonly caseId: string;
      readonly variant: string;
      readonly trial: number;
      readonly externalKind: "task";
      readonly reason: Extract<EvalPlanAction, { kind: "execute" }>["reason"];
    }
  | {
      readonly kind: "scorer";
      readonly actionId: string;
      readonly caseId: string;
      readonly variant: string;
      readonly trial: number;
      readonly scorerName: string;
      readonly externalKind: EvalScorerAction["externalKind"] | "unknown";
      readonly reason:
        | Exclude<EvalScorerAction, { kind: "reuse" }>["reason"]
        | "task_dependency_unresolved"
        | "external_classification_unknown";
    };

/** Planner-owned all-or-nothing decision consumed before execution. */
export type EvalPlanPreflight =
  | {
      readonly status: "admitted";
      readonly offline: boolean;
      readonly misses: readonly [];
    }
  | {
      readonly status: "blocked";
      readonly reason: "offline_miss";
      readonly offline: true;
      readonly misses: readonly EvalOfflineMiss[];
    };
