/** Internal carrier for durable managed-generation completion. @internal */

import type { ThreadMessageInput } from "../thread/types";

/** Canonical owner-Thread publication prepared after managed execution. */
export interface ManagedThreadPublication {
  readonly threadId: string;
  readonly after?: string;
  readonly messages: readonly ThreadMessageInput[];
}

/** Provider-neutral evidence available before owner-Thread publication. */
export interface ManagedGenerationPreparedExecution {
  readonly output: unknown;
  readonly publication?: ManagedThreadPublication;
  readonly preparationDecisionIds: readonly string[];
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
