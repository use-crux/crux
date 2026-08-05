/** Exact Agent-versus-Flow Session target inference. */

import type { AnyAgent, InferAgentInput, InferAgentOutput } from "../agent";
import type { FlowHandle } from "../flow/handle-types";
import type { FlowSignalMap, FlowSignalPayload } from "../flow/signals";
import type {
  SignalOccurrenceFor,
  StaticSignalSource,
} from "../signal/source";
import type { AnyFlowTarget } from "../work/target-types";
import type {
  WorkTargetInput,
  WorkTargetOutput,
} from "../work/target-types";
import type { GenerationModel } from "../generation-model";
import type { Session, SessionModelGuard, SessionOptions } from "./types";

/**
 * First-party targets accepted by durable `session()` / `getSession()`.
 *
 * @remarks V1 supports only Agent and exported Flow handles. Dynamic values,
 * unexported objects, and extension protocols are rejected at the type layer.
 */
export type SessionTarget = AnyAgent | AnyFlowTarget;

/** Narrow a Session target to an Agent definition. @internal */
export type SessionAgentTarget<TTarget extends SessionTarget> =
  TTarget extends AnyAgent ? TTarget : never;

/** Narrow a Session target to an exported Flow handle. @internal */
export type SessionFlowTarget<TTarget extends SessionTarget> =
  TTarget extends AnyFlowTarget ? TTarget : never;

/** Exact public input accepted by one Session target. */
export type SessionTargetInput<TTarget extends SessionTarget> =
  TTarget extends AnyAgent
    ? InferAgentInput<TTarget>
    : TTarget extends AnyFlowTarget
      ? WorkTargetInput<TTarget>
      : never;

/** Exact terminal result produced by one Session target. */
export type SessionTargetOutput<TTarget extends SessionTarget> =
  TTarget extends AnyAgent
    ? InferAgentOutput<TTarget>
    : TTarget extends AnyFlowTarget
      ? WorkTargetOutput<TTarget>
      : never;

/**
 * Resume payload accepted by a Flow Session's declared static Signal sources.
 *
 * @remarks Agent Sessions do not expose a typed resume surface; external
 * Signal deliveries become Session ingress rather than Flow wait payloads.
 * For static Signal sources the resume value is the occurrence payload; local
 * Flow signal contracts retain their Zod/no-payload inference.
 */
export type SessionTargetResume<TTarget extends SessionTarget> =
  TTarget extends FlowHandle<
    infer _TOutput,
    infer _TInput,
    infer TSignals extends FlowSignalMap | undefined,
    infer _TName extends string
  >
    ? TSignals extends FlowSignalMap
      ? {
          readonly [TName in keyof TSignals & string]: TSignals[TName] extends StaticSignalSource
            ? SignalOccurrenceFor<TSignals[TName]>["payload"]
            : FlowSignalPayload<TSignals[TName]>;
        }[keyof TSignals & string]
      : never
    : never;

/** Yield/progress surface retained for joinable Session activations. */
export type SessionTargetProgress = import("../work/progress").WorkProgress;

/**
 * Infer the exact Session handle for one Agent or Flow target.
 *
 * @typeParam TTarget - Agent or exported Flow bound to the Session key.
 */
export type SessionForTarget<TTarget extends SessionTarget> = Session<
  SessionTargetInput<TTarget>,
  SessionTargetOutput<TTarget>
> &
  (TTarget extends AnyFlowTarget
    ? FlowSessionSurface<TTarget>
    : AgentSessionSurface);

/** Shared durable Signal subscription surface for Agent and Flow Sessions. */
export type SessionSubscriptionSurface<TSource = StaticSignalSource> = {
  /**
   * Persist one durable Signal subscription for this Session.
   *
   * @remarks Idempotent by Session, Signal identity, and canonical match key.
   * Active subscriptions fan out independently on Signal publication.
   * Predicate closures are rejected; use match data or static declarations.
   * Agent Sessions queue matching payloads as typed Agent input at the next
   * safe boundary (or start a parked turn). Flow Sessions also gate
   * Session-owned Flow waiters.
   */
  subscribe(source: TSource): Promise<SessionSubscription>;
  /** List active durable Signal subscriptions owned by this Session. */
  subscriptions(): Promise<readonly SessionSubscription[]>;
};

/** Agent Session Signal subscription surface. */
export type AgentSessionSurface = {
  readonly targetKind: "agent";
} & SessionSubscriptionSurface<StaticSignalSource>;

/** Flow-only Session operations layered onto the shared Session handle. */
export type FlowSessionSurface<TTarget extends AnyFlowTarget> = {
  readonly targetKind: "flow";
} & SessionSubscriptionSurface<SessionSubscriptionSource<TTarget>>;

/** Match-only Signal source accepted by dynamic Flow Session subscription. */
export type SessionSubscriptionSource<TTarget extends AnyFlowTarget> =
  TTarget extends FlowHandle<
    infer _TOutput,
    infer _TInput,
    infer TSignals extends FlowSignalMap | undefined,
    infer _TName extends string
  >
    ? TSignals extends FlowSignalMap
      ? DeclaredSessionSignalSource<TSignals>
      : StaticSignalSource
    : StaticSignalSource;

type DeclaredSessionSignalSource<TSignals extends FlowSignalMap> = {
  readonly [TName in keyof TSignals]: TSignals[TName] extends StaticSignalSource
    ? TSignals[TName]
    : never;
}[keyof TSignals];

/**
 * One durable Signal subscription owned by a Session.
 *
 * @remarks `unsubscribe()` marks the subscription inactive for future Signal
 * publications. Already accepted occurrence deliveries remain on the durable
 * occurrence ledger and are not rolled back.
 */
export interface SessionSubscription {
  /** Stable subscription identity within the Session. */
  readonly id: string;
  /** Base Signal identity. */
  readonly signalId: string;
  /** Canonical match data when the subscription is filtered. */
  readonly match?: unknown;
  /**
   * Mark this subscription inactive for future publications.
   *
   * @remarks Idempotent. Does not cancel deliveries already accepted for past
   * occurrences.
   */
  unsubscribe(): Promise<void>;
}

/** Agent Session options retain the GenerationModel guard. */
export type AgentSessionOptions<
  TAgent extends AnyAgent,
  TModel extends GenerationModel | undefined,
> = SessionOptions<TAgent, TModel> & SessionModelGuard<TAgent, TModel>;

/** Flow Session options require only the stable key. */
export type FlowSessionOptions = {
  /** Stable caller-controlled key bound to one Flow within a Runtime namespace. */
  readonly key: string;
};
