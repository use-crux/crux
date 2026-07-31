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
import {
  deleteThread,
  emptyThreadOwnerRegistry,
  type ThreadOwnerRegistry,
} from "./delete";
import { ThreadError } from "./errors";
import { assertThreadId } from "./ids";
import { commitThreadTurn, readThreadHistory } from "./entry";
import { redactThreadMessages } from "./redact";
import { commitThreadEdit } from "./store/alternatives";
import { commitThreadAppend } from "./store/commit";
import { readThread } from "./store/read";
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
  return createThreadHandle(options, emptyThreadOwnerRegistry);
}

/** Create a Thread handle with an internal durable-owner registry seam. */
export function createThreadHandle(
  options: ThreadOptions,
  ownerRegistry: ThreadOwnerRegistry,
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
  const append: Thread["append"] = (input, appendOptions) =>
    commitThreadAppend(resolveStorage(), options.id, input, appendOptions);
  const read: Thread["read"] = (readOptions) =>
    readThread(resolveStorage(), options.id, readOptions);
  const readHistory: Thread["readHistory"] = () => readThreadHistory(read);
  const commitTurn: Thread["commitTurn"] = (turn) =>
    commitThreadTurn(
      (messages, expectedHead) =>
        commitThreadAppend(resolveStorage(), options.id, messages, {
          expectedHead,
        }),
      turn,
    );
  const edit: Thread["edit"] = (messageId, patch) =>
    commitThreadEdit(resolveStorage(), options.id, messageId, patch);
  const select: Thread["select"] = (messageId) =>
    selectThread(resolveStorage(), options.id, messageId);
  const redact: Thread["redact"] = (messageId) =>
    redactThreadMessages(resolveStorage(), options.id, messageId);
  const deleteHandle: Thread["delete"] = () =>
    deleteThread(resolveStorage(), options.id, ownerRegistry);
  return Object.freeze({
    _tag: "Thread",
    id: options.id,
    append,
    read,
    readHistory,
    commitTurn,
    edit,
    select,
    redact,
    delete: deleteHandle,
  });
}
