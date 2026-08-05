/**
 * Linearizable Thread owner registry.
 *
 * @remarks Session registration, close, kill, and delete must use these
 * `mutate()` transitions so concurrent Thread deletion cannot race past an
 * owner that still retains the Thread.
 */

import { mutateRecord, type Storage } from "../storage";
import { ThreadError } from "./errors";
import { assertThreadId } from "./ids";
import { threadControlKey } from "./store/keys";
import {
  parseThreadControlRecord,
  type ThreadControlRecord,
} from "./store/records";

/** The public standalone Thread's selected-head owner. */
export const MAIN_THREAD_OWNER_ID = "main";

/** Lifecycle state retained for every durable Thread owner. */
export type ThreadOwnerState = "open" | "closed";

/** Stable identity and lifecycle state of one durable Thread owner. */
export interface ThreadOwner {
  readonly id: string;
  readonly state: ThreadOwnerState;
}

/** Optional initial selected head when registering a new owner. */
export interface RegisterThreadOwnerOptions {
  /**
   * Pin the new owner's head to an already-published message id.
   *
   * @remarks Used by Session fork/clone so the child never aliases a live head.
   */
  readonly head?: string;
}

/** Register one durable owner without changing an existing selected head. */
export async function registerThreadOwner(
  storage: Storage,
  threadId: string,
  owner: ThreadOwner,
  options: RegisterThreadOwnerOptions = {},
): Promise<void> {
  assertThreadId(owner.id, "Thread owner id");
  assertOwnerState(owner.state);
  if (owner.id === MAIN_THREAD_OWNER_ID) {
    throw new ThreadError(
      "identity_conflict",
      `Thread owner "${owner.id}" is reserved for the public Thread handle.`,
    );
  }
  if (options.head !== undefined) {
    assertThreadId(options.head, "Thread owner head");
  }
  await mutateRecord(storage.records, threadControlKey(threadId), (current) => {
    const control = current ? parseThreadControlRecord(current) : null;
    if (control?.state === "deleted") {
      throw new ThreadError(
        "deleted",
        `Thread "${threadId}" has been deleted.`,
      );
    }
    const currentState = control?.owners[owner.id];
    if (currentState !== undefined) {
      if (currentState !== owner.state) {
        throw new ThreadError(
          "identity_conflict",
          `Thread owner "${owner.id}" already has state "${currentState}".`,
        );
      }
      if (
        options.head !== undefined &&
        control?.heads[owner.id] !== undefined &&
        control.heads[owner.id] !== options.head
      ) {
        throw new ThreadError(
          "identity_conflict",
          `Thread owner "${owner.id}" already has a different selected head.`,
        );
      }
      return { type: "none" };
    }
    const now = new Date().toISOString();
    const owners = { ...(control?.owners ?? {}), [owner.id]: owner.state };
    const heads =
      options.head === undefined
        ? { ...(control?.heads ?? {}) }
        : { ...(control?.heads ?? {}), [owner.id]: options.head };
    const next: ThreadControlRecord = control
      ? {
          ...control,
          owners,
          heads,
          updatedAt: now,
        }
      : {
          schema: 1,
          state: "live",
          owners,
          heads,
          leaves: {},
          redactions: {},
          removals: {},
          pendingReceipts: {},
          createdAt: now,
          updatedAt: now,
        };
    return { type: "put", value: next };
  });
}

/**
 * Ensure an owner exists without fighting later lifecycle state transitions.
 *
 * @remarks Used by Thread handles that re-enter storage. If the owner is
 * already registered (open or closed), this is a no-op. Initial registration
 * still rejects deleted Threads.
 */
export async function ensureThreadOwnerPresent(
  storage: Storage,
  threadId: string,
  owner: ThreadOwner,
): Promise<void> {
  assertThreadId(owner.id, "Thread owner id");
  assertOwnerState(owner.state);
  if (owner.id === MAIN_THREAD_OWNER_ID) {
    throw new ThreadError(
      "identity_conflict",
      `Thread owner "${owner.id}" is reserved for the public Thread handle.`,
    );
  }
  await mutateRecord(storage.records, threadControlKey(threadId), (current) => {
    const control = current ? parseThreadControlRecord(current) : null;
    if (control?.state === "deleted") {
      throw new ThreadError(
        "deleted",
        `Thread "${threadId}" has been deleted.`,
      );
    }
    if (control?.owners[owner.id] !== undefined) return { type: "none" };
    const now = new Date().toISOString();
    const next: ThreadControlRecord = control
      ? {
          ...control,
          owners: { ...control.owners, [owner.id]: owner.state },
          updatedAt: now,
        }
      : {
          schema: 1,
          state: "live",
          owners: { [owner.id]: owner.state },
          heads: {},
          leaves: {},
          redactions: {},
          removals: {},
          pendingReceipts: {},
          createdAt: now,
          updatedAt: now,
        };
    return { type: "put", value: next };
  });
}

/**
 * Transition one registered owner's lifecycle state.
 *
 * @remarks Open → closed is the Session close/kill barrier. Missing owners are
 * no-ops so delete/close retries stay idempotent after partial failure.
 */
export async function setThreadOwnerState(
  storage: Storage,
  threadId: string,
  ownerId: string,
  state: ThreadOwnerState,
): Promise<void> {
  assertThreadId(ownerId, "Thread owner id");
  assertOwnerState(state);
  await mutateRecord(storage.records, threadControlKey(threadId), (current) => {
    if (!current) return { type: "none" };
    const control = parseThreadControlRecord(current);
    if (control.state === "deleted") {
      throw new ThreadError(
        "deleted",
        `Thread "${threadId}" has been deleted.`,
      );
    }
    const currentState = control.owners[ownerId];
    if (currentState === undefined || currentState === state) {
      return { type: "none" };
    }
    return {
      type: "put",
      value: {
        ...control,
        owners: { ...control.owners, [ownerId]: state },
        updatedAt: new Date().toISOString(),
      },
    };
  });
}

/**
 * Remove one owner from the Thread registry after Session deletion.
 *
 * @remarks Closed-but-undeleted Sessions remain owners. Only Session delete
 * unregisters, which is what unlocks whole-Thread deletion.
 */
export async function unregisterThreadOwner(
  storage: Storage,
  threadId: string,
  ownerId: string,
): Promise<void> {
  assertThreadId(ownerId, "Thread owner id");
  await mutateRecord(storage.records, threadControlKey(threadId), (current) => {
    if (!current) return { type: "none" };
    const control = parseThreadControlRecord(current);
    if (control.state === "deleted") return { type: "none" };
    if (control.owners[ownerId] === undefined) return { type: "none" };
    const owners = { ...control.owners };
    delete owners[ownerId];
    const heads = { ...control.heads };
    delete heads[ownerId];
    return {
      type: "put",
      value: {
        ...control,
        owners,
        heads,
        updatedAt: new Date().toISOString(),
      },
    };
  });
}

function assertOwnerState(state: ThreadOwnerState): void {
  if (state !== "open" && state !== "closed") {
    throw new ThreadError(
      "invalid_message",
      "Thread owner state must be open or closed.",
    );
  }
}
