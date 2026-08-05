import type { AnyAgent, InferAgentInput, InferAgentOutput } from "../agent";
import type {
  CapabilitiesOf,
  GenerationModel,
  RequiredLanguageCapabilities,
  Supports,
} from "../generation-model";
import type { ThreadReadOptions, ThreadSnapshot } from "../thread";
import type { ExecutionStats, WorkHandle } from "../work";

/**
 * Extract the model configured on an Agent definition.
 *
 * @typeParam A - Agent whose `model` field is retained exactly.
 */
export type AgentModel<A extends AnyAgent> = A["model"];

/**
 * Language capability facets statically required by an Agent Prompt and tools.
 *
 * @typeParam A - Agent whose Prompt output schema and tools drive the facets.
 */
export type AgentRequiredCapabilities<A extends AnyAgent> =
  RequiredLanguageCapabilities<A["prompt"], A["tools"]>;

type SessionModelField<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = [AgentModel<A>] extends [GenerationModel]
  ? { readonly model?: M }
  : { readonly model: M };

/**
 * Immutable identity and optional model selection for one durable Agent Session.
 *
 * @remarks `key` is required. `model` is required only when the Agent does not
 * already carry a {@link GenerationModel}; otherwise it is an immutable override.
 * @typeParam A - Agent target that owns the Session key.
 * @typeParam M - Optional Session-level generation model override.
 */
export type SessionOptions<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = {
  /** Stable caller-controlled key bound to one Agent within a Runtime namespace. */
  readonly key: string;
} & SessionModelField<A, M>;

type ResolvedSessionModel<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = M extends GenerationModel ? M : Extract<AgentModel<A>, GenerationModel>;

type IncompatibleGenerationModelError<
  A extends AnyAgent,
  M extends GenerationModel,
> = {
  readonly __cruxIncompatibleGenerationModel: {
    readonly message: "The supplied GenerationModel cannot execute this Agent";
    readonly required: AgentRequiredCapabilities<A>;
    readonly available: CapabilitiesOf<M>;
  };
};

/**
 * Compile-time guard that a Session can resolve a compatible GenerationModel.
 *
 * @remarks Exact missing language facets become a false type. Broad capability
 * evidence remains accepted for runtime preflight.
 */
export type SessionModelGuard<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = [ResolvedSessionModel<A, M>] extends [never]
  ? {
      readonly __cruxMissingGenerationModelBinding: "Bind a GenerationModel on the Agent or Session";
    }
  : Supports<
        CapabilitiesOf<Extract<ResolvedSessionModel<A, M>, GenerationModel>>,
        AgentRequiredCapabilities<A>
      > extends false
    ? IncompatibleGenerationModelError<
        A,
        Extract<ResolvedSessionModel<A, M>, GenerationModel>
      >
    : unknown;

/**
 * Read-only canonical Thread owner view for one durable Agent Session.
 *
 * @remarks Exposes only finalized Session-owned heads. There is no public
 * mutation surface on this view. Reads never auto-register owners: after
 * Session delete unregisters the owner, `read()` returns an empty owner path
 * without resurrecting ownership, so whole-Thread deletion remains allowed.
 */
export interface SessionThreadView {
  /** Stable id of the Thread owned by this Session. */
  readonly id: string;
  /**
   * Read the owner Thread's canonical snapshot with optional pagination.
   *
   * @returns A detached snapshot of finalized owner-head messages, or empty
   * when the owner is unregistered after Session delete.
   */
  read(options?: ThreadReadOptions): Promise<ThreadSnapshot>;
}

/**
 * One durably accepted input before or after activation linkage.
 *
 * @remarks Acceptance never waits for model execution.
 */
export interface SessionInputHandle {
  /** Stable accepted input id. */
  readonly id: string;
  /** Server-assigned, Session-local acceptance cursor. */
  readonly cursor: string;
  /** Time durable acceptance completed. */
  readonly acceptedAt: Date;
}

/**
 * One accepted Session input that can join its canonical Work occurrence.
 *
 * @typeParam TOutput - Exact Agent output retained by the shared Work.
 */
export interface SessionTurnHandle<TOutput> extends SessionInputHandle {
  /**
   * Resolve the canonical Work once an activation opportunity claims this input.
   *
   * @remarks Compatible inputs share one Work occurrence. The Promise observes
   * durable linkage; it does not start a second execution.
   */
  work(): Promise<WorkHandle<TOutput>>;
  /**
   * Join the exact Agent output retained by the canonical Work occurrence.
   *
   * @remarks May be called immediately after acceptance; it waits for terminal
   * completion of the linked Work.
   * @returns The Agent's exact inferred output.
   */
  result(): Promise<TOutput>;
}

/**
 * Detached compact lifecycle snapshot for one durable Session.
 *
 * @remarks `closing` and `closed` are lifecycle barriers. Killed Sessions
 * project as `closed`. Deleted Sessions reject status reads.
 */
export interface SessionStatus {
  /** Current execution or lifecycle state. */
  readonly state: "parked" | "running" | "blocked" | "closing" | "closed";
  /** Newest durably accepted input cursor, when any input was accepted. */
  readonly acceptedCursor?: string;
  /** Newest successfully processed input cursor, when any turn completed. */
  readonly processedCursor?: string;
  /** Accepted inputs that have not reached a terminal turn boundary. */
  readonly pendingInputs: number;
  /** Canonical Work occurrences that have not completed successfully. */
  readonly pendingWork: number;
}

/**
 * Immutable parent boundary retained by a forked Session.
 *
 * @remarks Values are detached snapshots. They never track later parent heads.
 */
export interface SessionForkLineage {
  /** Parent Session identity at the fork barrier. */
  readonly sessionId: string;
  /** Parent accepted-cursor high-water mark at the fork barrier. */
  readonly cursor: string;
  /** Exact Thread control revision observed when the child head was pinned. */
  readonly threadRevision: string;
}

/** Payload-free direct child summary returned by {@link Session.forks}. */
export interface SessionForkSummary {
  readonly sessionId: string;
  readonly forkedFrom: SessionForkLineage;
}

/**
 * Payload-free lifecycle summary for one recently accepted Session input.
 *
 * @remarks Never includes prompt text, input values, tool arguments, or outputs.
 */
export interface SessionInputInspection {
  /** Stable accepted input identity. */
  readonly id: string;
  /** Server-assigned Session-local cursor. */
  readonly cursor: string;
  /** Current canonical Work linkage state. */
  readonly state: "accepted" | "queued" | "running" | "completed" | "blocked";
  /** Canonical Work occurrence, once linked. */
  readonly workId?: string;
  /** Whether durable prepared execution evidence awaits or survived replay. */
  readonly checkpointPrepared: boolean;
  /** First real provider boundary where this input became model-visible. */
  readonly delivery?: SessionInputDeliveryInspection;
}

/** Payload-free evidence of one input's first model-visible boundary. */
export interface SessionInputDeliveryInspection {
  /** Zero-based semantic provider-call index within its activation. */
  readonly stepIndex: number;
  /** Existing loop condition that opened the delivery boundary. */
  readonly reason: "initial" | "tool-result" | "validation-retry";
  /** Time the atomic delivery claim committed. */
  readonly deliveredAt: Date;
}

/** Payload-free durable preparation checkpoint for one Session activation. */
export interface SessionCheckpointInspection {
  /** Accepted input whose canonical Work owns this checkpoint. */
  readonly inputId: string;
  /** Canonical Work occurrence executing or replaying the turn. */
  readonly workId: string;
  /** Time the write-once prepared checkpoint became durable. */
  readonly checkpointedAt: Date;
  /** Exact canonical Thread basis observed before provider dispatch. */
  readonly thread: {
    readonly revision: string;
    readonly range: string;
    readonly offset: number;
    readonly length: number;
    readonly start?: string;
    readonly end?: string;
  };
  /** Sealed provider-request identities whose decisions were journaled. */
  readonly requestIds: readonly string[];
  /** Honest coverage for the bounded request identity list. */
  readonly requestCoverage: "complete" | "truncated";
}

/** Payload-safe recovery condition found while reading Session diagnostics. */
export interface SessionRecoveryDiagnostic {
  /** Stable recovery failure code. */
  readonly code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE";
  /** Smallest operator action that can restore recovery. */
  readonly nextStep: string;
}

/**
 * Bounded payload-safe operational view of one durable Agent Session.
 *
 * @remarks Input identities are capped at 64 with explicit coverage. Private
 * prompts, inputs, outputs, reasoning, and credentials are never included.
 */
export interface SessionInspection {
  /** Stable Session identity. */
  readonly id: string;
  /** Immutable Agent target identity. */
  readonly targetId: string;
  /** Session-owned canonical Thread identity. */
  readonly threadId: string;
  /** Whether durable accepted work still requires a wake opportunity. */
  readonly wakePending: boolean;
  /** Newest accepted input identities, ordered by cursor and capped at 64. */
  readonly inputs: readonly SessionInputInspection[];
  /** Newest durable prepared checkpoint, when its safe evidence is readable. */
  readonly checkpoint?: SessionCheckpointInspection;
  /** Payload-safe recovery diagnostic when prepared evidence cannot be read. */
  readonly recovery?: SessionRecoveryDiagnostic;
  /** Honest coverage for bounded identity projections. */
  readonly coverage: {
    readonly inputs: "complete" | "truncated";
    readonly limit: 64;
  };
}

declare const sessionOutput: unique symbol;

/**
 * Durable, keyed, target-specific input owner for an Agent or Flow.
 *
 * @typeParam TInput - Target input accepted by {@link Session.send}.
 * @typeParam TOutput - Exact target output joined through turn handles.
 * @remarks Creating a Session does not run the target. Each `send` accepts
 * ordered ingress; one canonical Runtime Work occurrence owns each activation.
 * Flow Sessions may also arm durable Signal subscriptions that fan out on
 * publication and gate Session-owned Flow waiters.
 */
export interface Session<TInput, TOutput = unknown> {
  /** Stable deterministic Session identity. */
  readonly id: string;
  /** Read-only view of the Session-owned canonical Thread. */
  readonly thread: SessionThreadView;
  /**
   * Immutable parent boundary when this Session was created by {@link Session.fork}.
   *
   * @remarks Absent for root Sessions created by `session()`.
   */
  readonly forkedFrom?: SessionForkLineage;
  /**
   * Accept one typed input and retained wake intent.
   *
   * @remarks Resolves after durable acceptance only; never waits for execution.
   * Rejects after close/kill barriers and for deleted Sessions.
   */
  send(input: TInput): Promise<SessionTurnHandle<TOutput>>;
  /**
   * Validate and accept every input atomically in array order.
   *
   * @remarks On any invalid member the entire batch fails before cursors advance.
   * An empty array resolves to a frozen empty list without allocation.
   */
  sendMany(
    inputs: readonly TInput[],
  ): Promise<readonly SessionTurnHandle<TOutput>[]>;
  /** Read a detached immutable compact snapshot of canonical Session state. */
  status(): Promise<SessionStatus>;
  /** Read bounded payload-safe ordering and recovery diagnostics. */
  inspect(): Promise<SessionInspection>;
  /**
   * Read bounded statistics for the complete addressed Session lifetime.
   *
   * @remarks Reuses the owner-scoped statistics ledger and public
   * {@link ExecutionStats} shape. Session ingress outcomes
   * (accepted/deduplicated/delivered/resumed/dropped) are exact totals with
   * first-64 identity attribution under `inputs`.
   */
  stats(): Promise<ExecutionStats>;
  /**
   * Read ordered, reconnectable Session state/event records.
   *
   * @remarks Without `after`, emits `session.snapshot` (`initial`) then every
   * retained event from the earliest retained position through the live tail.
   * A valid `after` resumes strictly after that cursor. An expired/unknown
   * `after` emits `session.snapshot` (`cursor-expired`) then continues from
   * the earliest retained event. Snapshot events replace local reducer state;
   * later retained events are authoritative (may restate snapshot facts).
   * Closed Sessions end after the terminal `session.status` event. Retention
   * is bounded by the durable event port — slow consumers cannot retain
   * unbounded history.
   */
  stream(
    options?: import("./events").SessionStreamOptions,
  ): AsyncIterable<import("./events").SessionEvent>;
  /**
   * Seal external ingress, deactivate Signal subscriptions, and drain.
   *
   * @remarks Joinable and idempotent. Deactivates Session subscriptions at the
   * barrier, then returns only after currently represented activation/input
   * obligations drain and state is `closed`. Nested causal Work trees beyond
   * pending-input/work counters are not yet counted. Does not wake a parked
   * Session merely for maintenance.
   */
  close(): Promise<void>;
  /**
   * Fence the Session immediately and revoke active Work commit authority.
   *
   * @remarks Distinct from graceful close. Idempotent. Deactivates Signal
   * subscriptions, cancels active Work, marks the Thread owner closed, and
   * rejects late claim/checkpoint/start and Thread commits after the fence.
   */
  kill(): Promise<void>;
  /**
   * Retention-safe delete after close or kill.
   *
   * @remarks Removes Thread ownership through the linearizable owner registry
   * so whole-Thread deletion can proceed. Keyed recreation is rejected.
   */
  delete(): Promise<void>;
  /**
   * Create a child Session owner/head pinned to this Session's current revision.
   *
   * @remarks The child never aliases the parent's mutable head. Lineage is
   * immutable. `clone()` is an alias for the same barrier. The return type is
   * the same exact handle shape as the parent (Agent or Flow).
   */
  fork(): Promise<this>;
  /** Alias for {@link Session.fork}. */
  clone(): Promise<this>;
  /** List direct children created by fork/clone. */
  forks(): Promise<readonly SessionForkSummary[]>;
  /** Exact target output retained for later joinable Session results. @internal */
  readonly [sessionOutput]?: TOutput;
}

/**
 * Infer the target-specific Session handle owned by one Agent definition.
 *
 * @typeParam TAgent - Agent whose Prompt input/output types are retained.
 * @remarks Prefer {@link SessionForTarget} when the target may be a Flow.
 */
export type SessionFor<TAgent extends AnyAgent> =
  import("./target-types").SessionForTarget<TAgent>;
