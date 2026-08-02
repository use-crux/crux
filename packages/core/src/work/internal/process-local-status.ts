/**
 * Internal process-local Work status representations and snapshots.
 *
 * @internal
 * @module
 */

interface InternalWorkStatusBase {
  readonly id: string;
  readonly acceptedAt: Date;
  readonly updatedAt: Date;
}

/** Minimal lifecycle exposed by the first internal Work tracer. @internal */
export type InternalWorkStatus =
  | (InternalWorkStatusBase & { readonly state: "queued" })
  | (InternalWorkStatusBase & {
      readonly state: "running";
      readonly startedAt: Date;
    })
  | (InternalWorkStatusBase & {
      readonly state: "completed";
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly resultAvailable: true;
    })
  | (InternalWorkStatusBase & {
      readonly state: "failed";
      readonly startedAt: Date;
      readonly failedAt: Date;
    })
  | (InternalWorkStatusBase & {
      readonly state: "cancel-requested";
      readonly startedAt: Date;
      readonly cancellationRequestedAt: Date;
    })
  | (InternalWorkStatusBase & {
      readonly state: "cancelled";
      readonly startedAt?: Date;
      readonly cancelledAt: Date;
    });

interface StoredWorkStatusBase {
  readonly id: string;
  readonly acceptedAt: number;
  readonly updatedAt: number;
}

/** Internal timestamp-backed lifecycle representation. @internal */
export type StoredWorkStatus =
  | (StoredWorkStatusBase & { readonly state: "queued" })
  | (StoredWorkStatusBase & {
      readonly state: "running";
      readonly startedAt: number;
    })
  | (StoredWorkStatusBase & {
      readonly state: "completed";
      readonly startedAt: number;
      readonly completedAt: number;
      readonly resultAvailable: true;
    })
  | (StoredWorkStatusBase & {
      readonly state: "failed";
      readonly startedAt: number;
      readonly failedAt: number;
    })
  | (StoredWorkStatusBase & {
      readonly state: "cancel-requested";
      readonly startedAt: number;
      readonly cancellationRequestedAt: number;
    })
  | (StoredWorkStatusBase & {
      readonly state: "cancelled";
      readonly startedAt?: number;
      readonly cancelledAt: number;
    });

/** Materialize a detached lifecycle snapshot from immutable timestamps. @internal */
export function workStatusSnapshot(
  status: StoredWorkStatus,
): InternalWorkStatus {
  const base = {
    id: status.id,
    acceptedAt: new Date(status.acceptedAt),
    updatedAt: new Date(status.updatedAt),
  };

  switch (status.state) {
    case "queued":
      return Object.freeze({ ...base, state: status.state });
    case "running":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
        completedAt: new Date(status.completedAt),
        resultAvailable: status.resultAvailable,
      });
    case "failed":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
        failedAt: new Date(status.failedAt),
      });
    case "cancel-requested":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
        cancellationRequestedAt: new Date(status.cancellationRequestedAt),
      });
    case "cancelled":
      return Object.freeze({
        ...base,
        state: status.state,
        ...(status.startedAt === undefined
          ? undefined
          : { startedAt: new Date(status.startedAt) }),
        cancelledAt: new Date(status.cancelledAt),
      });
  }
}
