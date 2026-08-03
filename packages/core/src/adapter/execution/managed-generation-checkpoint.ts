/** Shared pre-publication checkpoint boundary for managed generation. */

import { managedGenerationCheckpoint } from "../../generation-model/execution-checkpoint";
import { preparationDecision } from "../../request/prepare/journal";
import type { AdapterExecutionGenerateArgs } from "./run-types";
import {
  commitThreadPublication,
  isThreadReplay,
  prepareThreadPublication,
  validateThreadReplay,
  type ManagedThreadInvocation,
  type ManagedThreadResult,
} from "./thread-history";
import type { FinalStepInfo } from "../result-accumulator";
import type { ThreadCommit } from "../../thread";

interface ManagedGenerationResult extends ManagedThreadResult {
  readonly object?: unknown;
  readonly pendingApprovals?: readonly unknown[];
  readonly threadCommit?: ThreadCommit;
  readonly steps: readonly FinalStepInfo[];
  readonly _meta?: unknown;
}

/** Checkpoint accepted execution, then publish its owner Thread turn. @internal */
export async function checkpointAndCommitManagedGeneration(
  args: AdapterExecutionGenerateArgs<unknown>,
  invocation: ManagedThreadInvocation,
  result: ManagedGenerationResult,
): Promise<ThreadCommit | undefined> {
  if (result.threadCommit || result.pendingApprovals) return undefined;
  await validateThreadReplay(invocation, isThreadReplay(result));
  const publication = prepareThreadPublication(invocation, result);
  const checkpoint = args[managedGenerationCheckpoint];
  const checkpointed = checkpoint
    ? await checkpoint({
        output: result.object ?? result.text,
        publication,
        preparationDecisions: result.steps.flatMap((step) => {
          const decision = step.request
            ? preparationDecision(step.request)
            : undefined;
          return decision ? [decision] : [];
        }),
      })
    : undefined;
  const selected = checkpointed?.publication ?? publication;
  if (!selected) return undefined;
  const commit = await commitThreadPublication(invocation, selected);
  await checkpointed?.afterPublication?.();
  return commit;
}
