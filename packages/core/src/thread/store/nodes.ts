/**
 * Thread message normalization and immutable node creation.
 *
 * Canonical persisted messages and their identities are prepared before the
 * control record publishes reachability.
 *
 * @module
 */

import {
  encodePersistedMessages,
  type EncodeState,
  type PersistedMessage,
} from "../../content/persisted-message";
import type { Message } from "../../generation/messages";
import type { JsonObject, Storage } from "../../storage";
import { ThreadError } from "../errors";
import type { ThreadGroupMember } from "../groups";
import { assertThreadId, generateThreadMessageId } from "../ids";
import { threadMessageIdentity } from "../identity";
import type { ThreadMessageInput } from "../types";
import { threadNodeKey } from "./keys";
import {
  parseThreadNodeRecord,
  type ThreadNodeRecord,
} from "./records";
import type { ReplayMessage } from "./replay";

/** Normalize message inputs and derive their stable persisted identities. */
export async function prepareThreadMessages(
  storage: Storage,
  inputs: readonly ThreadMessageInput[],
): Promise<readonly ReplayMessage[]> {
  const ids = inputs.map((input) => input.id ?? generateThreadMessageId());
  ids.forEach((id) => assertThreadId(id, "Thread message id"));
  if (new Set(ids).size !== ids.length) {
    throw new ThreadError(
      "identity_conflict",
      "One append batch cannot reuse the same message id.",
    );
  }
  const state: EncodeState = { storage, dedupe: new Map(), writtenRefs: [] };
  let encoded: readonly PersistedMessage[];
  try {
    encoded = await encodePersistedMessages(inputs.map(withoutId), state);
  } catch (error) {
    throw new ThreadError(
      "invalid_message",
      "Thread message could not be normalized to the canonical persisted form.",
      { cause: error },
    );
  }
  return encoded.map((message, index) => ({
    id: ids[index]!,
    message,
    identity: threadMessageIdentity(message),
  }));
}

/** Build one immutable record for each member of a causal group. */
export function createThreadNodes(
  members: readonly ThreadGroupMember[],
  parentId: string | null,
  groupId: string,
  createdAt: string,
): readonly ThreadNodeRecord[] {
  return members.map((member, index) => ({
    schema: 1,
    id: member.id,
    parentId: index === 0 ? parentId : members[index - 1]!.id,
    groupId,
    seq: member.seq,
    groupEnd: member.groupEnd,
    createdAt,
    state: "live",
    message: member.message as PersistedMessage & JsonObject,
    identity: member.identity,
  }));
}

/**
 * Create immutable nodes idempotently and return the canonical stored records.
 */
export async function createImmutableThreadNodes(
  storage: Storage,
  threadId: string,
  nodes: readonly ThreadNodeRecord[],
): Promise<readonly ThreadNodeRecord[]> {
  const stored: ThreadNodeRecord[] = [];
  for (const node of nodes) {
    const key = threadNodeKey(threadId, node.id);
    if (await storage.records.create(key, node)) {
      stored.push(node);
      continue;
    }
    const current = await storage.records.get(key);
    const existing = current ? parseThreadNodeRecord(current) : null;
    if (!existing || !sameImmutableNode(existing, node)) {
      throw new ThreadError(
        "identity_conflict",
        `Thread message id "${node.id}" is already reserved for different content or position.`,
      );
    }
    stored.push(existing);
  }
  return stored;
}

function withoutId(input: ThreadMessageInput): Message {
  return {
    role: input.role,
    content: input.content,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } as Message;
}

function sameImmutableNode(
  left: ThreadNodeRecord,
  right: ThreadNodeRecord,
): boolean {
  return (
    left.id === right.id &&
    left.parentId === right.parentId &&
    left.groupId === right.groupId &&
    left.seq === right.seq &&
    left.groupEnd === right.groupEnd &&
    left.state === "live" &&
    left.identity === right.identity &&
    left.editOf === right.editOf &&
    left.revisionOf === right.revisionOf
  );
}
