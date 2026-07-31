/**
 * Causal-group derivation and protocol validation.
 *
 * Tool calls, their matching results, and the following response are kept in
 * one indivisible append so pagination and branching never split lifecycle.
 *
 * @module
 */

import type { PersistedMessage } from "../content/persisted-message";
import { ThreadError } from "./errors";
import { threadGroupIdentity } from "./identity";

/** Derived immutable position for one member of an append batch. */
export interface ThreadGroupMember {
  readonly id: string;
  readonly message: PersistedMessage;
  readonly identity: string;
  readonly assetRefs: readonly string[];
  readonly seq: number;
  readonly groupEnd: boolean;
}

/** Derive one deterministic causal group after validating tool lifecycle. */
export function deriveThreadGroup(
  parentId: string | null,
  messages: readonly {
    readonly id: string;
    readonly message: PersistedMessage;
    readonly identity: string;
    readonly assetRefs: readonly string[];
  }[],
): { readonly id: string; readonly members: readonly ThreadGroupMember[] } {
  validateToolLifecycle(messages.map((entry) => entry.message));
  const id = threadGroupIdentity({
    parentId,
    messageIds: messages.map((entry) => entry.id),
    identities: messages.map((entry) => entry.identity),
  });
  return {
    id,
    members: messages.map((entry, seq) => ({
      ...entry,
      seq,
      groupEnd: seq === messages.length - 1,
    })),
  };
}

function validateToolLifecycle(messages: readonly PersistedMessage[]): void {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      const toolCallId = message.metadata?.toolCallId;
      if (typeof toolCallId !== "string" || !pending.delete(toolCallId)) {
        throw new ThreadError(
          "invalid_message",
          "Tool-result messages must match a preceding assistant tool call in the same append batch.",
        );
      }
      continue;
    }
    if (pending.size > 0) {
      throw new ThreadError(
        "invalid_message",
        "Every assistant tool call must have a matching tool result before the next message.",
      );
    }
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call") {
        if (pending.has(part.toolCallId)) {
          throw new ThreadError(
            "invalid_message",
            `Tool call "${part.toolCallId}" appears more than once in one append batch.`,
          );
        }
        pending.add(part.toolCallId);
      }
    }
  }
  if (pending.size > 0) {
    throw new ThreadError(
      "invalid_message",
      "Every assistant tool call must have a matching tool result in the same append batch.",
    );
  }
}
