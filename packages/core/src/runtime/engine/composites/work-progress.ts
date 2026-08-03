/** Atomic latest-progress replacement for application Work. */

import type { WorkId } from "../../ports/ids";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import {
  initialApplicationWorkState,
  isApplicationWorkTerminal,
} from "../application-work-state";
import {
  applicationWorkTimingFact,
  applicationUpdatedAt,
  recordApplicationWorkStatistics,
} from "../application-work-statistics";
import type { RuntimeWorkItem } from "../work";

/** Validated progress input accepted by the Runtime composite. */
export interface WorkProgressCompositeInput {
  readonly namespace: string;
  readonly workId: WorkId;
  readonly progress: {
    readonly message?: string;
    readonly current?: number;
    readonly total?: number;
  };
}

/** Result of replacing an application Work progress snapshot. */
export type WorkProgressCompositeResult =
  | { readonly outcome: "updated"; readonly work: RuntimeWorkItem }
  | { readonly outcome: "not-found" | "already-terminal" };

/** Replace progress without changing lifecycle, ownership, or wake state. */
export async function updateWorkProgressInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: WorkProgressCompositeInput,
): Promise<WorkProgressCompositeResult> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  if (!current) return { outcome: "not-found" };
  if (isApplicationWorkTerminal(current)) {
    return { outcome: "already-terminal" };
  }

  const now = deps.now();
  const application = recordApplicationWorkStatistics(
    current.application ??
      initialApplicationWorkState(current.workId, current.createdAt),
    current.workId,
    current.createdAt,
    now,
    [
      applicationWorkTimingFact(
        current.status,
        applicationUpdatedAt(current),
        now,
      ),
    ],
  );
  const progress = Object.freeze({
    ...input.progress,
    updatedAt: now.toISOString(),
  });
  const event = await tx.events.append({
    namespace: input.namespace,
    name: `crux.work:${input.workId}`,
    payload: {
      schemaVersion: 1,
      type: "work.progress",
      workId: input.workId,
      progress,
    },
  });
  const work: RuntimeWorkItem = Object.freeze({
    ...current,
    application: Object.freeze({
      ...application,
      updatedAt: now.toISOString(),
      progress,
      latestEventCursor: event.eventId,
    }),
  });
  await tx.state.putWork(work);
  return Object.freeze({ outcome: "updated", work });
}
