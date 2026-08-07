/** Durable Session identity and accepted-ingress records. @internal */

import type { JsonValue } from "../../storage";
import type { WorkId } from "./ids";
import type { RuntimeResultRef } from "../results/types";
import type { StatisticsLedgerExport } from "../../statistics";
import type { RuntimeTargetDefinitionRef } from "./target-definition";

/**
 * Durable Session control-record lifecycle.
 *
 * @remarks `prepared`/`ready` are open construction states. `closing` is the
 * graceful drain barrier. `closed` and `killed` are terminal readable states.
 * `deleted` is a key tombstone that rejects silent recreation.
 */
export type RuntimeSessionLifecycleState =
  | "prepared"
  | "ready"
  | "closing"
  | "closed"
  | "killed"
  | "deleted";

/** Immutable fork lineage retained on child Sessions. */
export interface RuntimeSessionForkLineage {
  readonly sessionId: string;
  /** Parent accepted-cursor high-water mark at the fork barrier. */
  readonly cursor: number;
  /** Exact Thread control revision observed when the child head was pinned. */
  readonly threadRevision: string;
}

export interface RuntimeSessionRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  /** First-party Session target kind retained at creation. */
  readonly targetKind: "agent" | "flow";
  readonly threadId: string;
  /**
   * Immutable statically declared GenerationModel selected when created.
   *
   * @remarks Required for Agent Sessions. Absent for Flow Sessions.
   */
  readonly model?: {
    readonly definitionId: string;
    readonly fingerprint: string;
  };
  readonly state: RuntimeSessionLifecycleState;
  readonly acceptedCursor: number;
  readonly processedCursor?: number;
  readonly pendingInputs: number;
  readonly pendingWork: number;
  readonly blockedWork: number;
  /** One bounded owner ledger for the complete Session lifetime. */
  readonly statistics: StatisticsLedgerExport;
  readonly wakePending: boolean;
  /** One canonical Work reserved for the current finite activation. */
  readonly activation?: RuntimeSessionActivation;
  /**
   * Pinned Flow definition for Flow Sessions.
   *
   * @remarks Agent Sessions leave this unset and use GenerationModel instead.
   */
  readonly definition?: RuntimeTargetDefinitionRef;
  /** Parent Session identity when this Session was created by fork/clone. */
  readonly parentSessionId?: string;
  /** Immutable lineage snapshot for a forked child Session. */
  readonly forkedFrom?: RuntimeSessionForkLineage;
  /**
   * Work fenced by `kill()` that must still be cancelled on retry.
   *
   * @remarks Set when kill transitions from a non-killed state. Retained so a
   * crash between the Session fence and Work cancellation can complete cancel
   * on the next kill() without restoring commit authority.
   */
  readonly fencedWorkId?: WorkId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Durable Signal subscription owned by one Session. */
export interface RuntimeSessionSubscriptionRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly subscriptionId: string;
  readonly signalId: string;
  /** Canonical match data when the subscription is filtered. */
  readonly match?: JsonValue;
  /**
   * Stable match identity used for idempotent upsert and delivery matching.
   *
   * @remarks Empty string means an unfiltered bare Signal. Always derived by
   * the shared Session subscription match codec, never raw JSON.stringify.
   */
  readonly matchKey: string;
  readonly state: "active" | "unsubscribed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Canonical Work reserved for one cursor-consecutive Session activation. */
export interface RuntimeSessionActivation {
  readonly workId: WorkId;
  readonly primaryInputId: string;
  readonly target: string;
  readonly state: "queued" | "running";
}

export interface RuntimeSessionInputRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly cursor: number;
  readonly input: JsonValue;
  readonly acceptedAt: string;
  /** Write-once linkage and lifecycle of this input's canonical Work. */
  readonly work?: RuntimeSessionTurnWork;
  /** First real provider boundary where this input became model-visible. */
  readonly delivery?: RuntimeSessionInputDelivery;
  /** Write-once reference to pre-publication execution evidence. */
  readonly preparedExecution?: RuntimeSessionPreparedExecution;
}

/** Honest model-delivery evidence for one independently accepted input. */
export interface RuntimeSessionInputDelivery {
  readonly stepIndex: number;
  readonly reason: "initial" | "tool-result" | "validation-retry";
  readonly deliveredAt: string;
}

export interface RuntimeSessionTurnWork {
  readonly workId: WorkId;
  readonly target: string;
  readonly state: "queued" | "running" | "completed" | "blocked";
}

export interface RuntimeSessionTurnInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly now: Date;
}

/** Input for reserving one canonical Work for the next activation. */
export interface ReserveRuntimeSessionTurnInput extends RuntimeSessionTurnInput {
  readonly workId: WorkId;
  readonly target: string;
}

/** Cursor-consecutive inputs atomically claimed by one activation Work. */
export interface RuntimeSessionActivationClaim {
  readonly activation: RuntimeSessionActivation;
  readonly inputs: readonly RuntimeSessionInputRecord[];
}

/** Input for atomically claiming compatible ingress at a provider boundary. */
export interface ClaimRuntimeSessionStepInputsInput extends RuntimeSessionTurnInput {
  readonly workId: WorkId;
  readonly stepIndex: number;
  readonly reason: RuntimeSessionInputDelivery["reason"];
}

/** Newly delivered inputs and the exact acceptance cutoff considered. */
export interface RuntimeSessionStepInputClaim {
  readonly acceptedCursor: number;
  readonly inputs: readonly RuntimeSessionInputRecord[];
}

/** Durable Session–Work checkpoint for one prepared Agent execution. */
export interface RuntimeSessionPreparedExecution {
  readonly workId: WorkId;
  readonly preparedResultRef: RuntimeResultRef;
  readonly checkpointedAt: string;
}

/** Input accepted by the write-once prepared-execution checkpoint. */
export interface CheckpointRuntimeSessionExecutionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly workId: WorkId;
  readonly preparedResultRef: RuntimeResultRef;
  readonly now: Date;
}

export interface CreateRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly targetKind: RuntimeSessionRecord["targetKind"];
  readonly threadId: string;
  readonly model?: RuntimeSessionRecord["model"];
  readonly definition?: RuntimeTargetDefinitionRef;
  readonly now: Date;
}

/** Input for creating or reusing one durable Session Signal subscription. */
export interface UpsertRuntimeSessionSubscriptionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly subscriptionId: string;
  readonly signalId: string;
  readonly match?: JsonValue;
  /**
   * Already-derived canonical match identity for this subscription.
   *
   * @remarks Callers must pass the shared Session subscription match codec
   * result. Adapters persist and compare this value without re-deriving it.
   */
  readonly matchKey: string;
  readonly now: Date;
}

export type CreateRuntimeSessionResult =
  | {
      readonly kind: "created" | "existing";
      readonly session: RuntimeSessionRecord;
    }
  | { readonly kind: "conflict"; readonly session: RuntimeSessionRecord }
  | { readonly kind: "tombstone"; readonly session: RuntimeSessionRecord };

/** Input for the ordered close barrier. */
export interface CloseRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly now: Date;
}

/** Input for fenced kill terminalization. */
export interface KillRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly now: Date;
}

/** Input for retention-safe Session deletion. */
export interface DeleteRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly now: Date;
}

/** Input for creating a child Session owner/head from a pinned parent revision. */
export interface ForkRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly childSessionId: string;
  readonly childKeyHash: string;
  readonly threadRevision: string;
  readonly now: Date;
}

export interface ForkRuntimeSessionResult {
  readonly parent: RuntimeSessionRecord;
  readonly child: RuntimeSessionRecord;
}

export interface AcceptRuntimeSessionInputsInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputs: readonly JsonValue[];
  /**
   * Optional stable input identities parallel to {@link inputs}.
   *
   * @remarks Used by Signal-subscription ingress so delivery identity is
   * restart-safe and deduplicable via {@link RuntimeSessionStorePort.getInput}.
   * When omitted, adapters assign cursor-based input ids.
   */
  readonly inputIds?: readonly string[];
  readonly now: Date;
}

/** Input for appending owner-scoped mechanical Session statistics facts. */
export interface AppendRuntimeSessionStatisticsInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly facts: readonly import("../../statistics").StatisticsFact[];
  readonly now: Date;
}

/** Bounded accepted-input page used for payload-safe Session inspection. */
export interface RuntimeSessionInputInspectionPage {
  readonly inputs: readonly RuntimeSessionInputRecord[];
  readonly truncated: boolean;
}

/** Storage operations that preserve Session identity and ingress ordering. */
export interface RuntimeSessionStorePort {
  /** Prepare identity without claiming that its cross-store Thread owner exists. */
  create(input: CreateRuntimeSessionInput): Promise<CreateRuntimeSessionResult>;
  getByKey(
    namespace: string,
    keyHash: string,
  ): Promise<RuntimeSessionRecord | null>;
  /** Read one canonical Session summary by public identity. */
  get(
    namespace: string,
    sessionId: string,
  ): Promise<RuntimeSessionRecord | null>;
  /** Read one accepted input for handle-to-Work/result resolution. */
  getInput(
    namespace: string,
    sessionId: string,
    inputId: string,
  ): Promise<RuntimeSessionInputRecord | null>;
  /** Read one accepted input by its Session-local cursor. */
  getInputAtCursor(
    namespace: string,
    sessionId: string,
    cursor: number,
  ): Promise<RuntimeSessionInputRecord | null>;
  /** Read the newest accepted identities without exposing their payloads publicly. */
  inspectInputs(
    namespace: string,
    sessionId: string,
    limit: number,
  ): Promise<RuntimeSessionInputInspectionPage>;
  /** Mark a prepared Session ready after durable Thread owner registration. */
  markReady(
    namespace: string,
    sessionId: string,
    now: Date,
  ): Promise<RuntimeSessionRecord>;
  /** Atomically append a validated batch and advance the Session cursor. */
  acceptInputs(
    input: AcceptRuntimeSessionInputsInput,
  ): Promise<readonly RuntimeSessionInputRecord[]>;
  /**
   * Append mechanical Session statistics facts for one owner.
   *
   * @remarks Optional on stores that cannot rewrite Session statistics; Core
   * Signal ingress and acceptance paths no-op when absent.
   */
  appendStatistics?(
    input: AppendRuntimeSessionStatisticsInput,
  ): Promise<RuntimeSessionRecord>;
  /** Reserve one queued canonical Work without claiming a moving cutoff. */
  reserveTurn(
    input: ReserveRuntimeSessionTurnInput,
  ): Promise<RuntimeSessionActivation>;
  /** Claim the longest compatible prefix through the atomic current cutoff. */
  startTurn(
    input: RuntimeSessionTurnInput,
  ): Promise<RuntimeSessionActivationClaim | null>;
  /** Read the ordered inputs currently linked to one activation Work. */
  getTurnInputs(
    namespace: string,
    sessionId: string,
    workId: WorkId,
  ): Promise<readonly RuntimeSessionInputRecord[]>;
  /** Claim and mark the compatible prefix visible at one real provider boundary. */
  claimStepInputs(
    input: ClaimRuntimeSessionStepInputsInput,
  ): Promise<RuntimeSessionStepInputClaim>;
  /** Read one accepted turn's prepared execution checkpoint. */
  getPreparedExecution(
    namespace: string,
    sessionId: string,
    inputId: string,
  ): Promise<RuntimeSessionPreparedExecution | null>;
  /** Retain one prepared execution reference exactly once. */
  checkpointPreparedExecution(
    input: CheckpointRuntimeSessionExecutionInput,
  ): Promise<RuntimeSessionPreparedExecution>;
  /** Complete one published turn and park when no accepted turn remains. */
  completeTurn(input: RuntimeSessionTurnInput): Promise<RuntimeSessionRecord>;
  /** Retain one terminal safe blocker without exposing its payload. */
  blockTurn(input: RuntimeSessionTurnInput): Promise<RuntimeSessionRecord>;
  /** Resolve the Session whose current activation owns a Work occurrence. */
  getByActivationWorkId(
    namespace: string,
    workId: WorkId,
  ): Promise<RuntimeSessionRecord | null>;
  /**
   * Create or reuse one active Signal subscription for a Session.
   *
   * @remarks Idempotent by Session, Signal identity, and canonical match data.
   */
  upsertSubscription(
    input: UpsertRuntimeSessionSubscriptionInput,
  ): Promise<RuntimeSessionSubscriptionRecord>;
  /** Read one subscription by identity. */
  getSubscription(
    namespace: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<RuntimeSessionSubscriptionRecord | null>;
  /** List active subscriptions for one Session. */
  listSubscriptions(
    namespace: string,
    sessionId: string,
  ): Promise<readonly RuntimeSessionSubscriptionRecord[]>;
  /**
   * List every active subscription for one Signal in a Runtime namespace.
   *
   * @remarks Used by Signal publication to fan out independent Session
   * deliveries without scanning every Session identity.
   */
  listActiveSubscriptionsForSignal(
    namespace: string,
    signalId: string,
  ): Promise<readonly RuntimeSessionSubscriptionRecord[]>;
  /** Mark one subscription unsubscribed without deleting history. */
  unsubscribe(
    namespace: string,
    sessionId: string,
    subscriptionId: string,
    now: Date,
  ): Promise<RuntimeSessionSubscriptionRecord>;
  /**
   * Seal external ingress and enter closing, or closed when already drained.
   *
   * @remarks Idempotent for closing/closed/killed. Rejects deleted Sessions.
   */
  close?(input: CloseRuntimeSessionInput): Promise<RuntimeSessionRecord>;
  /**
   * Fence the Session immediately and clear active activation linkage.
   *
   * @remarks Idempotent. Callers cancel residual Work through the kernel.
   */
  kill?(input: KillRuntimeSessionInput): Promise<RuntimeSessionRecord>;
  /**
   * Tombstone a closed or killed Session and strip retained ingress payloads.
   *
   * @remarks Does not unregister the Thread owner; the public delete path does
   * that through the linearizable Thread owner registry after this transition.
   */
  delete?(input: DeleteRuntimeSessionInput): Promise<RuntimeSessionRecord>;
  /**
   * Create a child Session that shares the Thread with pinned independent head metadata.
   *
   * @remarks Child records store lineage only; Thread owner/head registration
   * remains on the RecordStore `mutate()` path.
   */
  fork?(input: ForkRuntimeSessionInput): Promise<ForkRuntimeSessionResult>;
  /** List direct child Sessions created by fork/clone. */
  listForks?(
    namespace: string,
    sessionId: string,
  ): Promise<readonly RuntimeSessionRecord[]>;
}
