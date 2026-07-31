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
import type { AssetRef } from "../../asset";
import type { Message } from "../../generation/messages";
import type { JsonObject, Storage } from "../../storage";
import { ThreadError } from "../errors";
import type { ThreadGroupMember } from "../groups";
import { assertThreadId, generateThreadMessageId } from "../ids";
import { threadMessageIdentity } from "../identity";
import type { ThreadMessageInput } from "../types";
import { threadControlKey, threadNodeKey, threadNodePrefix } from "./keys";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadLiveNodeRecord,
} from "./records";
import type { ReplayMessage } from "./replay";

/** Normalize message inputs and derive their stable persisted identities. */
export async function prepareThreadMessages(
  storage: Storage,
  threadId: string,
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
  const prepared: ReplayMessage[] = [];
  const writtenRefs: AssetRef[] = [];
  const attemptId = generateThreadMessageId();
  try {
    for (const [index, input] of inputs.entries()) {
      const messageId = ids[index]!;
      const firstWrittenRef = writtenRefs.length;
      const state: EncodeState = {
        storage,
        dedupe: new Map(),
        writtenRefs,
        assetKey: (path, contentIdentity) =>
          `thread/${encodeURIComponent(threadId)}/asset/${encodeURIComponent(messageId)}/${encodeURIComponent(path)}/${encodeURIComponent(contentIdentity)}/${encodeURIComponent(attemptId)}`,
      };
      let message: PersistedMessage;
      [message] = await encodePersistedMessages([withoutId(input)], state);
      const assetRefs = Object.freeze(
        writtenRefs.slice(firstWrittenRef).map(({ uri }) => uri),
      );
      prepared.push({
        id: messageId,
        message: message!,
        identity: threadMessageIdentity(message!, assetRefs),
        assetRefs,
      });
    }
    return prepared;
  } catch (error) {
    await cleanupUnreferencedThreadAssets(storage, threadId, writtenRefs);
    throw new ThreadError(
      "invalid_message",
      "Thread message could not be normalized to the canonical persisted form.",
      { cause: error },
    );
  }
}

/** Delete newly written assets that no stored Thread node currently owns. */
export async function cleanupUnreferencedThreadAssets(
  storage: Storage,
  threadId: string,
  refs: readonly AssetRef[],
): Promise<void> {
  if (refs.length === 0) return;
  const referenced = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await storage.records.list(threadNodePrefix(threadId), {
      cursor,
    });
    for (const { value } of page.entries) {
      if (
        Array.isArray(value.assetRefs) &&
        value.assetRefs.every((uri) => typeof uri === "string")
      ) {
        value.assetRefs.forEach((uri) => referenced.add(uri));
      }
    }
    cursor = page.cursor;
  } while (cursor);
  for (const uri of new Set(refs.map((ref) => ref.uri))) {
    if (!referenced.has(uri)) await storage.assets?.delete({ uri });
  }
}

/** Build one immutable record for each member of a causal group. */
export function createThreadNodes(
  members: readonly ThreadGroupMember[],
  parentId: string | null,
  groupId: string,
  createdAt: string,
): readonly ThreadLiveNodeRecord[] {
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
    assetRefs: member.assetRefs,
  }));
}

/**
 * Create immutable nodes idempotently and return the canonical stored records.
 */
export async function createImmutableThreadNodes<
  T extends ThreadLiveNodeRecord,
>(
  storage: Storage,
  threadId: string,
  nodes: readonly T[],
): Promise<readonly T[]> {
  return (await createImmutableThreadNodesWithOwnership(
    storage,
    threadId,
    nodes,
  )).nodes;
}

/** Create immutable nodes and report which records this attempt won. */
export async function createImmutableThreadNodesWithOwnership<
  T extends ThreadLiveNodeRecord,
>(
  storage: Storage,
  threadId: string,
  nodes: readonly T[],
): Promise<{
  readonly nodes: readonly T[];
  readonly created: readonly boolean[];
}> {
  const stored: T[] = [];
  const created: boolean[] = [];
  for (const node of nodes) {
    const key = threadNodeKey(threadId, node.id);
    if (await storage.records.create(key, node)) {
      await fenceDeletedThread(storage, threadId, node);
      stored.push(node);
      created.push(true);
      continue;
    }
    const current = await storage.records.get(key);
    const existing = current ? parseThreadNodeRecord(current) : null;
    if (
      !existing ||
      existing.state === "redacted" ||
      !sameImmutableNode(existing, node)
    ) {
      throw new ThreadError(
        "identity_conflict",
        `Thread message id "${node.id}" is already reserved for different content or position.`,
      );
    }
    await fenceDeletedThread(storage, threadId, existing);
    stored.push(existing as T);
    created.push(false);
  }
  return { nodes: stored, created };
}

async function fenceDeletedThread(
  storage: Storage,
  threadId: string,
  node: ThreadLiveNodeRecord,
): Promise<void> {
  const rawControl = await storage.records.get(threadControlKey(threadId));
  if (!rawControl || parseThreadControlRecord(rawControl).state !== "deleted") {
    return;
  }
  if (node.assetRefs.length > 0 && !storage.assets) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" cannot erase an aborted message without its owning AssetStore.`,
    );
  }
  for (const uri of node.assetRefs) {
    await storage.assets!.delete({ uri });
  }
  await storage.records.delete(threadNodeKey(threadId, node.id));
  throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
}

function withoutId(input: ThreadMessageInput): Message {
  return {
    role: input.role,
    content: input.content,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } as Message;
}

function sameImmutableNode(
  left: ThreadLiveNodeRecord,
  right: ThreadLiveNodeRecord,
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
