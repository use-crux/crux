/** Atomic durable ownership detachment for application Work. */

import type { WorkId } from "../../ports/ids";
import type { RuntimeStoreTransaction } from "../../store";
import { appendApplicationWorkStatusEvent } from "../application-work-events";
import {
  initialApplicationWorkState,
  isApplicationWorkTerminal,
} from "../application-work-state";
import {
  applicationWorkTimingFact,
  applicationUpdatedAt,
  recordApplicationWorkStatistics,
} from "../application-work-statistics";
import type { RuntimeCompositeDeps } from "../composites";
import type { RuntimeWorkItem } from "../work";

/** Input accepted by the application Work detach composite. */
export interface WorkDetachCompositeInput {
  readonly namespace: string;
  readonly workId: WorkId;
}

/** Result of an idempotent ownership detach attempt. */
export type WorkDetachCompositeResult =
  | {
      readonly outcome: "detached" | "already-detached" | "already-terminal";
      readonly work: RuntimeWorkItem;
    }
  | { readonly outcome: "not-found" };

/** Detach an active application Work row without changing its lifecycle. */
export async function detachWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: WorkDetachCompositeInput,
): Promise<WorkDetachCompositeResult> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  if (!current) return { outcome: "not-found" };
  if (isApplicationWorkTerminal(current)) {
    return Object.freeze({ outcome: "already-terminal", work: current });
  }
  let application =
    current.application ??
    initialApplicationWorkState(current.workId, current.createdAt);
  if (application.ownership.state === "detached") {
    return Object.freeze({ outcome: "already-detached", work: current });
  }

  const now = deps.now();
  application = recordApplicationWorkStatistics(
    application,
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
  const detached = await appendApplicationWorkStatusEvent(
    tx,
    Object.freeze({
      ...current,
      application: Object.freeze({
        ...application,
        updatedAt: now.toISOString(),
        ownership: Object.freeze({
          state: "detached",
          reason: "explicit",
          detachedAt: now.toISOString(),
        }),
      }),
    }),
  );
  await tx.state.putWork(detached);
  return Object.freeze({ outcome: "detached", work: detached });
}
