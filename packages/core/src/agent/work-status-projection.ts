/** Shared model-safe projection of owner-retained background Work. @internal */

import type {
  InternalOwnedWork,
  InternalWorkOwnerPort,
} from "../work/internal/owner-retained-work";
import type { InternalWorkStatus } from "../work/internal/process-local-kernel";

/** Maximum owner-inbox entries inspected for one model-facing projection. */
export const OWNER_WORK_STATUS_SCAN_LIMIT = 50;

/** Content-free, immutable lifecycle data safe to return to a parent model. */
export interface WorkStatusProjection {
  readonly work: {
    readonly kind: "work.ref";
    readonly id: string;
    readonly targetId: string;
    readonly guarantees: {
      readonly execution: "process-local";
      readonly rejoin: "process-local";
    };
  };
  readonly targetLabel: string;
  readonly state: InternalWorkStatus["state"];
  readonly attachment: "attached";
  readonly attempt: 1;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly resultAvailable: boolean;
}

/** Project bounded content-free statuses from one owner's retained inbox. */
export async function projectOwnerWorkStatuses(
  owner: InternalWorkOwnerPort,
  limit: number,
): Promise<readonly WorkStatusProjection[]> {
  const statuses = await Promise.all(
    owner.list().slice(0, limit).map(async ({ id }) => {
      const retained = owner.inspect(id);
      return retained
        ? projectWorkStatus(await retained.handle.status(), retained)
        : undefined;
    }),
  );
  return Object.freeze(
    statuses.filter(
      (status): status is WorkStatusProjection => status !== undefined,
    ),
  );
}

/** Convert an authoritative internal status into its model-safe projection. */
export function projectWorkStatus(
  status: InternalWorkStatus,
  retained: InternalOwnedWork,
): WorkStatusProjection {
  const base = {
    work: Object.freeze({
      kind: "work.ref" as const,
      id: status.id,
      targetId: retained.targetId,
      guarantees: Object.freeze({
        execution: "process-local" as const,
        rejoin: "process-local" as const,
      }),
    }),
    targetLabel: retained.targetLabel,
    state: status.state,
    attachment: "attached" as const,
    attempt: 1 as const,
    createdAt: status.acceptedAt.toISOString(),
    resultAvailable: status.state === "completed",
  };
  switch (status.state) {
    case "queued":
      return Object.freeze(base);
    case "running":
      return Object.freeze({ ...base, startedAt: status.startedAt.toISOString() });
    case "completed":
      return Object.freeze({
        ...base,
        startedAt: status.startedAt.toISOString(),
        finishedAt: status.completedAt.toISOString(),
      });
    case "failed":
      return Object.freeze({
        ...base,
        startedAt: status.startedAt.toISOString(),
        finishedAt: status.failedAt.toISOString(),
      });
    case "cancel-requested":
      return Object.freeze({ ...base, startedAt: status.startedAt.toISOString() });
    case "cancelled":
      return Object.freeze({
        ...base,
        ...(status.startedAt === undefined
          ? undefined
          : { startedAt: status.startedAt.toISOString() }),
        finishedAt: status.cancelledAt.toISOString(),
      });
  }
}
