/**
 * Prompt-resolution binding for canonical Threads.
 *
 * Managed execution receives only exact-history read and atomic-turn commit
 * capabilities, keeping navigation and erasure outside the adapter boundary.
 *
 * @module
 */

import type {
  ThreadHistoryEntry,
  ThreadTurnCommitInput,
} from "../prompt/context-types";
import type { Thread, ThreadCommit, ThreadMessage, ThreadMessageInput } from "./types";

type ReadThread = Thread["read"];
type CommitThread = (
  messages: readonly ThreadMessageInput[],
  expectedHead: string | null,
) => Promise<ThreadCommit>;

/** Read one exact selected Thread revision as provider-neutral messages. */
export async function readThreadHistory(
  read: ReadThread,
): ReturnType<ThreadHistoryEntry["readHistory"]> {
  const snapshot = await read();
  const messages = snapshot.entries.flatMap((entry) =>
    entry.kind === "message" ? [messageFromEntry(entry)] : [],
  );
  return {
    ...(snapshot.head ? { head: snapshot.head } : {}),
    messages: Object.freeze(messages),
  };
}

/** Publish one accepted managed turn as a single causal group. */
export function commitThreadTurn(
  commit: CommitThread,
  turn: ThreadTurnCommitInput,
): Promise<ThreadCommit> {
  return commit(turn.messages, turn.after ?? null);
}

function messageFromEntry(entry: ThreadMessage) {
  const {
    kind: _kind,
    id: _id,
    parentId: _parentId,
    createdAt: _createdAt,
    variant: _variant,
    ...message
  } = entry;
  void _kind;
  void _id;
  void _parentId;
  void _createdAt;
  void _variant;
  return Object.freeze(message);
}
