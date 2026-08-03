import type { InferAgentInput, AnyAgent } from "../agent";
import type { ThreadReadOptions, ThreadSnapshot } from "../thread";

/** Immutable application identity for one Agent Session. */
export interface SessionOptions {
  /** Stable caller-controlled key bound to one Agent within a Runtime namespace. */
  readonly key: string;
}

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

/** Durable, keyed, Agent-specific input owner. @typeParam TInput Agent input. */
export interface Session<TInput> {
  /** Stable deterministic Session identity. */
  readonly id: string;
  /** Read-only view of the Session-owned canonical Thread. */
  readonly thread: SessionThreadView;
  /** Accept one typed input and retained wake intent; never waits for execution. */
  send(input: TInput): Promise<SessionInputHandle>;
  /** Validate and accept every input atomically in array order. */
  sendMany(inputs: readonly TInput[]): Promise<readonly SessionInputHandle[]>;
}

/** Infer the target-specific Session handle owned by one Agent definition. */
export type SessionFor<TAgent extends AnyAgent> = Session<
  InferAgentInput<TAgent>
>;
