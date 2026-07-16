/** Injected side-effect boundaries for the portable Eval kernel. @internal */

import type { EvalTaskEvidenceEntry } from "./evidence";
import type { EvalScorerEvidenceEntry } from "./scorer-evidence";
import type { EvalRun, EvalTaskHostRequest, EvalTaskHostResult } from "./types";
import type { Score, Scorer } from "../../quality/scorers";
import type {
  EvalCostAction,
  EvalCostEstimationRequest,
  EvalCostEstimate,
} from "./cost-types";
import type { EvalBaselineV3 } from "./baseline-types";

export interface EvalTaskHost {
  execute(request: EvalTaskHostRequest): Promise<EvalTaskHostResult>;
}

export interface EvalClock {
  now(): number;
}

export interface EvalIdGenerator {
  next(kind: "run"): string;
}

export interface EvalRunStore {
  write(run: EvalRun): Promise<void>;
}

export interface EvalEvidenceStore {
  /** Stable adapter/store identity retained in run provenance. */
  readonly identity: string;
  /** Visibility guarantee used to explain immediate cross-run misses. */
  readonly consistency: "read_after_write" | "eventual";
  read(key: string): Promise<unknown>;
  write(entry: EvalTaskEvidenceEntry | EvalScorerEvidenceEntry): Promise<void>;
}

export interface EvalTaskIdentityDescription {
  readonly reusable: true;
  readonly managedTaskFingerprint: string;
  readonly hostContractFingerprint: string;
}

export type EvalTaskIdentityProviderResult =
  | EvalTaskIdentityDescription
  | {
      readonly reusable: false;
      readonly reason:
        | "registry_identity_unavailable"
        | "host_contract_unavailable";
    };

export interface EvalTaskIdentityProvider {
  describe(
    request: EvalTaskHostRequest,
  ): Promise<EvalTaskIdentityProviderResult>;
}

export interface EvalPlanningPorts {
  readonly evidenceStore: EvalEvidenceStore;
  readonly taskIdentity: EvalTaskIdentityProvider;
  readonly externalScorerHostContractFingerprint?: string;
  readonly costEstimator: EvalCostEstimator;
  readonly costConfirmation?: EvalCostConfirmationPort;
}

/** Pricing-aware maximum estimator supplied by the coordinating host. */
export interface EvalCostEstimator {
  /**
   * Apply managed model/router pricing and bounds first, then the existing
   * config override, returning `unknown` when neither proves a maximum.
   */
  estimate(
    action: EvalCostEstimationRequest,
  ): Promise<EvalCostEstimate> | EvalCostEstimate;
}

/** Single interactive confirmation for plans containing unknown costs. */
export interface EvalCostConfirmationPort {
  confirm(input: {
    readonly knownMaximumUsd: number;
    readonly unknownActions: readonly EvalCostAction[];
  }): Promise<boolean>;
}

export interface ExternalScorerHostRequest {
  readonly actionId: string;
  readonly scorerName: string;
  readonly scorer: Scorer<unknown, unknown, unknown>;
  readonly input: unknown;
  readonly output: unknown;
  readonly expected: unknown;
}

export interface ExternalScorerHost {
  execute(request: ExternalScorerHostRequest): Promise<Score>;
}

export interface EvalExecutionPorts {
  readonly taskHost: EvalTaskHost;
  readonly clock: EvalClock;
  readonly ids: EvalIdGenerator;
  readonly runStore: EvalRunStore;
  readonly evidenceStore?: EvalEvidenceStore;
  readonly externalScorerHost?: ExternalScorerHost;
  readonly reservations?: EvalReservationPort;
  /** Validated committed truth supplied before portable execution. */
  readonly baseline?: EvalBaselineV3;
}

/** Atomic shared budget boundary used before admitted external calls. */
export interface EvalReservationPort {
  reserve(input: {
    readonly reservationId: string;
    readonly actionId: string;
    readonly maximumUsd: number;
  }): Promise<{ readonly status: "reserved" | "rejected" }>;
  settle(input: {
    readonly reservationId: string;
    readonly actualUsd: number;
  }): Promise<void>;
}
