/** Internal carrier for durable managed-generation completion. @internal */

import type { ThreadMessageInput } from "../thread/types";
import type { ThreadHistoryRange } from "../request/history/source";
import type { PreparationDecisionInspection } from "../request/prepare/journal";
import type { StepReason } from "../request/prepare/step-context";

/** Canonical owner-Thread publication prepared after managed execution. */
export interface ManagedThreadPublication {
  readonly threadId: string;
  readonly after?: string;
  readonly messages: readonly ThreadMessageInput[];
  /** Exact canonical Thread revision and range read before provider dispatch. */
  readonly basis?: ThreadHistoryRange;
}

/** Provider-neutral evidence available before owner-Thread publication. */
export interface ManagedGenerationPreparedExecution {
  readonly output: unknown;
  readonly publication?: ManagedThreadPublication;
  /** Frozen accepted preparation decisions for every sealed provider request. */
  readonly preparationDecisions: readonly PreparationDecisionInspection[];
}

/** Checkpoint result whose publication may add durable caller-stable identities. */
export interface ManagedGenerationCheckpointResult {
  readonly publication?: ManagedThreadPublication;
  /** Continue immediately after the prepared Thread publication succeeds. @internal */
  readonly afterPublication?: () => void | Promise<void>;
}

/** Narrow internal checkpoint invoked after execution and before publication. */
export type ManagedGenerationCheckpoint = (
  prepared: ManagedGenerationPreparedExecution,
) => Promise<ManagedGenerationCheckpointResult>;

/** Opaque ExecuteOptions key used only by managed adapter runtimes. @internal */
export const managedGenerationCheckpoint: unique symbol = Symbol(
  "crux.managed-generation-checkpoint",
);

/** Durable Session observation made at one real provider-call boundary. */
export interface ManagedGenerationStepBoundaryInput {
  readonly stepIndex: number;
  readonly reason: StepReason;
}

/** One accepted Agent input claimed for independent boundary resolution. */
export interface ManagedGenerationStepIngress {
  readonly id: string;
  readonly cursor: number;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Ordered provider-neutral ingress accepted at one atomic cutoff. */
export interface ManagedGenerationStepBoundaryResult {
  readonly inputs: readonly ManagedGenerationStepIngress[];
}

/** Session coordinator hook invoked before preparation at each real step. */
export type ManagedGenerationStepBoundary = (
  input: ManagedGenerationStepBoundaryInput,
) => Promise<ManagedGenerationStepBoundaryResult>;

/** Opaque ExecuteOptions key installed only by the Session Runtime target. */
export const managedGenerationStepBoundary: unique symbol = Symbol(
  "crux.managed-generation-step-boundary",
);
