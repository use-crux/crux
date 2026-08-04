/**
 * Canonical Thread factory.
 *
 * Construction is inert: configured Storage is resolved only when an
 * operation executes, matching other authored Crux primitives.
 *
 * @module
 */

import { resolveRecords } from "../runtime/runtime";
import type { Storage } from "../storage";
import { deleteThread } from "./delete";
import { ThreadError } from "./errors";
import { assertThreadId } from "./ids";
import { commitThreadTurn, readThreadHistory } from "./entry";
import { observeThreadOperation } from "./observability";
import { registerThreadOwner, type ThreadOwner } from "./owner";
import { redactThreadMessages } from "./redact";
import { registerThreadInspectableResource } from "./runtime-bridge";
import { commitThreadEdit } from "./store/alternatives";
import { commitThreadAppend } from "./store/commit";
import { readThread } from "./store/read";
import { readThreadRevision } from "./store/revision";
import { selectThread } from "./store/select";
import type { Thread, ThreadOptions } from "./types";

/**
 * Create canonical provider-neutral conversation history.
 *
 * @param options - Stable identity and optional explicit Storage.
 * @returns A frozen, inert Thread handle.
 *
 * @example
 * ```ts
 * const conversation = thread({ id: "support-42", storage });
 * await conversation.append({ role: "user", content: "Hello" });
 * const snapshot = await conversation.read();
 * ```
 */
export function thread(options: ThreadOptions): Thread {
  return createThreadHandle(options);
}

/** Create a Thread handle bound to one optional durable owner. */
export function createThreadHandle(
  options: ThreadOptions,
  owner?: ThreadOwner,
): Thread {
  assertThreadId(options.id);
  let resolved: Storage | undefined;
  const resolveStorage = (): Storage => {
    if (resolved) return resolved;
    if (options.storage) {
      resolved = options.storage;
      return resolved;
    }
    try {
      resolved = Object.freeze({ records: resolveRecords() });
      return resolved;
    } catch (error) {
      throw new ThreadError(
        "unsupported_capability",
        `Thread "${options.id}" requires Storage. Configure config({ storage: { records } }) or pass thread({ storage }).`,
        { cause: error },
      );
    }
  };
  const withOwner = async <T>(run: (storage: Storage) => Promise<T>) => {
    const storage = resolveStorage();
    if (owner) await registerThreadOwner(storage, options.id, owner);
    return run(storage);
  };
  registerThreadInspectableResource(options.id, resolveStorage);
  const append: Thread["append"] = (input, appendOptions) => {
    const messages = Array.isArray(input) ? input : [input];
    return observeThreadOperation({
      threadId: options.id,
      operation: "append",
      attributes: {
        messageCount: messages.length,
        roles: messages.map(({ role }) => role),
      },
      run: () =>
        withOwner((storage) =>
          commitThreadAppend(
            storage,
            options.id,
            input,
            appendOptions,
            owner?.id,
          ),
        ),
      complete: (commit) => ({
        messageIds: commit.messageIds,
        decision: commit.status,
        selectedHead: commit.selectedHead,
        replayed: commit.replayed,
        ...(commit.parentId ? { parentId: commit.parentId } : {}),
      }),
    });
  };
  const read: Thread["read"] = (readOptions) =>
    observeThreadOperation({
      threadId: options.id,
      operation: "read",
      attributes: {
        ...(readOptions?.at ? { at: readOptions.at } : {}),
        ...(readOptions?.before ? { before: readOptions.before } : {}),
        ...(readOptions?.limit ? { limit: readOptions.limit } : {}),
      },
      run: () =>
        withOwner((storage) =>
          readThread(storage, options.id, readOptions, owner?.id),
        ),
      complete: (snapshot) => ({
        entryCount: snapshot.entries.length,
        messageCount: snapshot.entries.filter(
          ({ kind }) => kind === "message",
        ).length,
        removedCount: snapshot.entries.filter(
          ({ kind }) => kind === "removed",
        ).length,
        redactedCount: snapshot.entries.filter(
          ({ kind }) => kind === "redacted",
        ).length,
        roles: snapshot.entries.flatMap((entry) =>
          entry.kind === "message" ? [entry.role] : [],
        ),
        ...(snapshot.head ? { head: snapshot.head } : {}),
        ...(snapshot.cursor ? { cursor: snapshot.cursor } : {}),
      }),
    });
  const readHistory: Thread["readHistory"] = () => readThreadHistory(read);
  const validateRevision: Thread["validateRevision"] = async (revision) => {
    const current = await withOwner((storage) =>
      readThreadRevision(storage, options.id),
    );
    if (current !== revision) {
      throw new ThreadError(
        "identity_conflict",
        `Thread "${options.id}" changed after its request plan was sealed.`,
      );
    }
  };
  const commitTurn: Thread["commitTurn"] = (turn) =>
    observeThreadOperation({
      threadId: options.id,
      operation: "append",
      attributes: {
        source: "managed-execution",
        messageCount: turn.messages.length,
        roles: turn.messages.map(({ role }) => role),
      },
      run: () =>
        withOwner((storage) =>
          commitThreadTurn(
            (messages, expectedHead) =>
              commitThreadAppend(
                storage,
                options.id,
                messages,
                { expectedHead },
                owner?.id,
              ),
            turn,
          ),
        ),
      complete: (commit) => ({
        messageIds: commit.messageIds,
        decision: commit.status,
        selectedHead: commit.selectedHead,
        replayed: commit.replayed,
        ...(commit.parentId ? { parentId: commit.parentId } : {}),
      }),
    });
  const edit: Thread["edit"] = (messageId, patch) =>
    observeThreadOperation({
      threadId: options.id,
      operation: "edit",
      attributes: { targetId: messageId },
      run: () =>
        commitThreadEdit(resolveStorage(), options.id, messageId, patch),
      complete: (commit) => ({
        messageIds: commit.messageIds,
        decision: commit.status,
        selectedHead: commit.selectedHead,
        replayed: commit.replayed,
      }),
    });
  const select: Thread["select"] = (messageId) =>
    observeThreadOperation({
      threadId: options.id,
      operation: "select",
      attributes: { targetId: messageId },
      run: () => selectThread(resolveStorage(), options.id, messageId),
      complete: (snapshot) => ({
        entryCount: snapshot.entries.length,
        ...(snapshot.head ? { head: snapshot.head } : {}),
      }),
    });
  const redact: Thread["redact"] = (messageId) =>
    observeThreadOperation({
      threadId: options.id,
      operation: "redact",
      attributes: {
        messageIds: Array.isArray(messageId) ? messageId : [messageId],
      },
      run: () => redactThreadMessages(resolveStorage(), options.id, messageId),
      complete: () => ({ state: "redacted" }),
    });
  const deleteHandle: Thread["delete"] = () =>
    observeThreadOperation({
      threadId: options.id,
      operation: "delete",
      run: () => withOwner((storage) => deleteThread(storage, options.id)),
      complete: () => ({ state: "deleted" }),
    });
  return Object.freeze({
    _tag: "Thread",
    id: options.id,
    append,
    read,
    readHistory,
    validateRevision,
    commitTurn,
    edit,
    select,
    redact,
    delete: deleteHandle,
  });
}
