/** Injected side-effect boundaries for the portable Eval kernel. @internal */

import type { EvalTaskEvidenceEntry } from "./evidence";
import type { EvalScorerEvidenceEntry } from "./scorer-evidence";
import type { EvalRun, EvalTaskHostRequest, EvalTaskHostResult } from "./types";
import type { Score, Scorer } from "../../quality/scorers";

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
}
