/**
 * Causal grouping for caller-owned canonical transcripts.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import { RequestCompositionError } from "../errors";

/** One indivisible chronological history group. @internal */
export interface CausalMessageGroup {
  /** Messages that must be selected or omitted together. */
  readonly messages: readonly Message[];
}

/** Split a canonical caller transcript into a leading directive prefix and interaction groups. @internal */
export function causalMessageGroups(messages: readonly Message[]): {
  readonly prefix: readonly Message[];
  readonly groups: readonly CausalMessageGroup[];
} {
  assertValidToolLifecycle(messages);
  let prefixEnd = 0;
  while (messages[prefixEnd]?.role === "system") prefixEnd += 1;

  const groups: CausalMessageGroup[] = [];
  let current: Message[] = [];
  for (const message of messages.slice(prefixEnd)) {
    const hasResponse = current.some(
      (entry) => entry.role === "assistant" || entry.role === "tool",
    );
    if (
      current.length > 0 &&
      (message.role === "system" ||
        (message.role === "user" && hasResponse))
    ) {
      groups.push(Object.freeze({ messages: Object.freeze(current) }));
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) {
    groups.push(Object.freeze({ messages: Object.freeze(current) }));
  }

  return Object.freeze({
    prefix: Object.freeze(messages.slice(0, prefixEnd)),
    groups: Object.freeze(groups),
  });
}

function assertValidToolLifecycle(messages: readonly Message[]): void {
  const pending = new Set<string>();
  for (const message of messages) {
    if (
      pending.size > 0 &&
      (message.role === "user" || message.role === "system")
    ) {
      throw transcriptError(
        "A new history interaction begins before pending Tool calls have results.",
      );
    }
    if (message.role === "assistant") {
      if (pending.size > 0) {
        throw transcriptError(
          "An assistant continuation appears before pending Tool calls have results.",
        );
      }
      for (const id of assistantToolCallIds(message)) {
        if (pending.has(id)) {
          throw transcriptError(
            "A history interaction contains a duplicate Tool call identity.",
          );
        }
        pending.add(id);
      }
      continue;
    }
    if (message.role !== "tool") continue;
    const id = message.metadata?.toolCallId;
    if (typeof id !== "string" || id.length === 0 || !pending.delete(id)) {
      throw transcriptError(
        "A Tool result in history has no matching canonical Tool call.",
      );
    }
  }
  if (pending.size > 0) {
    throw transcriptError(
      "History ends before every canonical Tool call has a result.",
    );
  }
}

function assistantToolCallIds(
  message: Extract<Message, { role: "assistant" }>,
): string[] {
  const ids = new Set<string>();
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "tool-call" && part.toolCallId) {
        ids.add(part.toolCallId);
      }
    }
  }
  const metadataCalls = message.metadata?.toolCalls;
  if (Array.isArray(metadataCalls)) {
    for (const call of metadataCalls) {
      if (
        typeof call === "object" &&
        call !== null &&
        "id" in call &&
        typeof call.id === "string" &&
        call.id.length > 0
      ) {
        ids.add(call.id);
      }
    }
  }
  return [...ids];
}

function transcriptError(message: string): RequestCompositionError {
  const requestId = "request_history_transcript";
  return new RequestCompositionError(
    "INVALID_COMPOSITION",
    message,
    [
      {
        id: `${requestId}:causal-group`,
        code: "INVALID_HISTORY_TRANSCRIPT",
        contributor: "history",
        message,
      },
    ],
    requestId,
  );
}
