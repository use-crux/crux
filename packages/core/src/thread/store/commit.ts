/**
 * Atomic publication for generic Storage-backed Threads.
 *
 * Immutable nodes are created before one linearizable control mutation. Losing
 * an ordinary append race publishes an alternative instead of dropping or
 * silently rebasing history.
 *
 * @module
 */

import {
  mutateRecord,
  StorageError,
  type Storage,
} from "../../storage";
import { ThreadCommitError, ThreadError } from "../errors";
import { deriveThreadGroup } from "../groups";
import type {
  AppendOptions,
  ThreadCommit,
  ThreadMessageInput,
} from "../types";
import { threadControlKey, threadNodeKey } from "./keys";
import {
  createImmutableThreadNodes,
  createThreadNodes,
  prepareThreadMessages,
} from "./nodes";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
} from "./records";
import { replayThreadAppend } from "./replay";
import { isNodePublished } from "./read";

const OWNER = "main";
const CONSISTENCY_ATTEMPTS = 8;

interface CommitDecision {
  readonly status: "selected" | "alternative";
  readonly selectedHead: string;
  readonly replayed: boolean;
}

/** Normalize, persist, and atomically publish one append batch. */
export async function commitThreadAppend(
  storage: Storage,
  threadId: string,
  input: ThreadMessageInput | readonly ThreadMessageInput[],
  options: AppendOptions = {},
): Promise<ThreadCommit> {
  ensureMutationCapability(storage, threadId);
  const messages = Array.isArray(input) ? input : [input];
  if (messages.length === 0) {
    throw new ThreadError("invalid_message", "Thread append requires at least one message.");
  }
  const rawControl = await storage.records.get(threadControlKey(threadId));
  const observedControl = rawControl ? parseThreadControlRecord(rawControl) : null;
  assertLive(observedControl, threadId);
  const prepared = await prepareThreadMessages(storage, messages);
  const replay = await replayThreadAppend(
    storage,
    threadId,
    observedControl,
    prepared,
    options.after,
  );
  if (replay) return replay;
  const parentId = options.after ?? observedControl?.heads[OWNER] ?? null;
  if (options.after) {
    await assertAppendBoundary(storage, threadId, observedControl, options.after);
  }

  const group = deriveThreadGroup(parentId, prepared);
  const createdAt = new Date().toISOString();
  const nodes = await createImmutableThreadNodes(
    storage,
    threadId,
    createThreadNodes(group.members, parentId, group.id, createdAt),
  );

  const leafId = nodes.at(-1)!.id;
  const firstId = nodes[0]!.id;
  let decision: CommitDecision | undefined;
  try {
    await mutateRecord(storage.records, threadControlKey(threadId), async (current) => {
      const control = current ? parseThreadControlRecord(current) : null;
      assertLive(control, threadId);
      if (control && (await isNodePublished(storage, threadId, control, leafId))) {
        const selected = await isNodePublishedFromHead(
          storage,
          threadId,
          control.heads[OWNER],
          leafId,
        );
        decision = {
          status: selected ? "selected" : "alternative",
          selectedHead: selected ? leafId : control.heads[OWNER] ?? leafId,
          replayed: true,
        };
        return { type: "none" };
      }

      const now = new Date().toISOString();
      const currentHead = control?.heads[OWNER];
      const selected = currentHead === (parentId ?? undefined);
      const next: ThreadControlRecord = {
        schema: 1,
        state: "live",
        heads: {
          ...(control?.heads ?? {}),
          ...(selected ? { [OWNER]: leafId } : {}),
        },
        leaves: {
          ...(control?.leaves ?? {}),
          ...(!selected ? { [firstId]: leafId } : {}),
        },
        createdAt: control?.createdAt ?? now,
        updatedAt: now,
      };
      decision = {
        status: selected ? "selected" : "alternative",
        selectedHead: selected ? leafId : currentHead ?? leafId,
        replayed: false,
      };
      return { type: "put", value: next };
    });
  } catch (error) {
    throw mapCommitError(threadId, error);
  }

  if (!decision) {
    throw new ThreadCommitError(
      `Thread "${threadId}" commit completed without a publication decision.`,
    );
  }
  await assertReadYourWrites(storage, threadId, leafId);
  const receipt: ThreadCommit = {
    status: decision.status,
    messageIds: Object.freeze(nodes.map((node) => node.id)),
    ...(parentId ? { parentId } : {}),
    selectedHead: decision.selectedHead,
    committedAt: nodes[0]!.createdAt,
    replayed: decision.replayed,
  };
  return Object.freeze(receipt);
}

async function assertAppendBoundary(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord | null,
  messageId: string,
): Promise<void> {
  if (!control || !(await isNodePublished(storage, threadId, control, messageId))) {
    throw new ThreadError(
      "not_found",
      `Append target "${messageId}" is not published in Thread "${threadId}".`,
    );
  }
  const raw = await storage.records.get(threadNodeKey(threadId, messageId));
  const node = raw ? parseThreadNodeRecord(raw) : null;
  if (!node?.groupEnd) {
    throw new ThreadError(
      "invalid_group",
      `Append target "${messageId}" splits a causal group; target its final message instead.`,
    );
  }
}

async function assertReadYourWrites(
  storage: Storage,
  threadId: string,
  leafId: string,
): Promise<void> {
  for (let attempt = 0; attempt < CONSISTENCY_ATTEMPTS; attempt += 1) {
    const raw = await storage.records.get(threadControlKey(threadId));
    if (raw) {
      const control = parseThreadControlRecord(raw);
      if (await isNodePublished(storage, threadId, control, leafId)) return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, attempt));
  }
  throw new ThreadError(
    "unsupported_capability",
    `Thread "${threadId}" could not read its published commit. Configure config.storage with a strongly consistent records store that supports mutate().`,
  );
}

async function isNodePublishedFromHead(
  storage: Storage,
  threadId: string,
  head: string | undefined,
  messageId: string,
): Promise<boolean> {
  if (!head) return false;
  const control: ThreadControlRecord = {
    schema: 1,
    state: "live",
    heads: { [OWNER]: head },
    leaves: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  return isNodePublished(storage, threadId, control, messageId);
}

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation. Configure config.storage with a records store that supports mutate(); current @use-crux/upstash and @use-crux/convex adapters do.`,
    );
  }
}

function assertLive(
  control: ThreadControlRecord | null,
  threadId: string,
): void {
  if (control?.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
}

function mapCommitError(threadId: string, error: unknown): ThreadError {
  if (error instanceof ThreadError) return error;
  if (error instanceof StorageError && error.code === "unsupported_capability") {
    return new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires a records store with linearizable mutate() support.`,
      { cause: error },
    );
  }
  return new ThreadCommitError(
    `Thread "${threadId}" commit could not be published; visible history may be unchanged.`,
    error,
  );
}
