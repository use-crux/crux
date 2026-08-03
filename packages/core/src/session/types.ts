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
  /** Canonical Work handle owning lifecycle, Effect scope, and retained result. */
  readonly work: WorkHandle<TOutput>;
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
