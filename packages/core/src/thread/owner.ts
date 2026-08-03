/** Durable owner registration for independently selected Thread heads. */

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

/** Register one durable owner without changing its selected head. */
export async function registerThreadOwner(
  storage: Storage,
  threadId: string,
  owner: ThreadOwner,
): Promise<void> {
  assertThreadId(owner.id, "Thread owner id");
  if (owner.state !== "open" && owner.state !== "closed") {
    throw new ThreadError(
      "invalid_message",
      "Thread owner state must be open or closed.",
    );
  }
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
    const currentState = control?.owners[owner.id];
    if (currentState !== undefined) {
      if (currentState !== owner.state) {
        throw new ThreadError(
          "identity_conflict",
          `Thread owner "${owner.id}" already has state "${currentState}".`,
        );
      }
      return { type: "none" };
    }
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
