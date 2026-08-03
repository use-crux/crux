import type { AnyAgent, InferAgentInput, InferAgentOutput } from "../agent";
import type {
  CapabilitiesOf,
  GenerationModel,
  RequiredLanguageCapabilities,
  Supports,
} from "../generation-model";
import type { ThreadReadOptions, ThreadSnapshot } from "../thread";
import type { ExecutionStats, WorkHandle } from "../work";

/** Extract the model configured on an Agent. */
export type AgentModel<A extends AnyAgent> = A["model"];

/** Compute the language capabilities required by an Agent. */
export type AgentRequiredCapabilities<A extends AnyAgent> =
  RequiredLanguageCapabilities<A["prompt"], A["tools"]>;

type SessionModelField<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = [AgentModel<A>] extends [GenerationModel]
  ? { readonly model?: M }
  : { readonly model: M };

/** Immutable identity and model selection for one Agent Session. */
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

/** Validate that a Session resolves a compatible GenerationModel. */
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

/** Read-only canonical Thread owner view for one Session. */
export interface SessionThreadView {
  /** Stable id of the Thread owned by this Session. */
  readonly id: string;
  /** Read the owner Thread's canonical snapshot with optional pagination. */
  read(options?: ThreadReadOptions): Promise<ThreadSnapshot>;
}

/** Accepted input that is waiting for a later Agent turn. */
export interface SessionInputHandle {
  /** Stable accepted input id. */
  readonly id: string;
  /** Server-assigned, Session-local acceptance cursor. */
  readonly cursor: string;
  /** Time durable acceptance completed. */
  readonly acceptedAt: Date;
}

/** One accepted Session input linked to its canonical Work occurrence. */
export interface SessionTurnHandle<TOutput> extends SessionInputHandle {
  /** Resolve the canonical Work once an activation opportunity claims this input. */
  work(): Promise<WorkHandle<TOutput>>;
  /** Join the exact Agent output retained by the canonical Work occurrence. */
  result(): Promise<TOutput>;
}

/** Detached compact lifecycle snapshot for one live Session. */
export interface SessionStatus {
  /** Current live execution state; lifecycle closure is outside this API. */
  readonly state: "parked" | "running" | "blocked";
  /** Newest durably accepted input cursor, when any input was accepted. */
  readonly acceptedCursor?: string;
  /** Newest successfully processed input cursor, when any turn completed. */
  readonly processedCursor?: string;
  /** Accepted inputs that have not reached a terminal turn boundary. */
  readonly pendingInputs: number;
  /** Canonical Work occurrences that have not completed successfully. */
  readonly pendingWork: number;
}

/** Payload-free lifecycle summary for one recently accepted Session input. */
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

/** Bounded payload-safe operational view of one durable Session. */
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

/** Durable, keyed, Agent-specific input owner. @typeParam TInput Agent input. */
export interface Session<TInput, TOutput = unknown> {
  /** Stable deterministic Session identity. */
  readonly id: string;
  /** Read-only view of the Session-owned canonical Thread. */
  readonly thread: SessionThreadView;
  /** Accept one typed input and retained wake intent; never waits for execution. */
  send(input: TInput): Promise<SessionTurnHandle<TOutput>>;
  /** Validate and accept every input atomically in array order. */
  sendMany(
    inputs: readonly TInput[],
  ): Promise<readonly SessionTurnHandle<TOutput>[]>;
  /** Read a detached immutable compact snapshot of canonical Session state. */
  status(): Promise<SessionStatus>;
  /** Read bounded payload-safe ordering and recovery diagnostics. */
  inspect(): Promise<SessionInspection>;
  /** Read bounded statistics for the complete addressed Session lifetime. */
  stats(): Promise<ExecutionStats>;
  /** Exact Agent output retained for later joinable Session results. @internal */
  readonly [sessionOutput]?: TOutput;
}

/** Infer the target-specific Session handle owned by one Agent definition. */
export type SessionFor<TAgent extends AnyAgent> = Session<
  InferAgentInput<TAgent>,
  InferAgentOutput<TAgent>
>;
