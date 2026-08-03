/** Durable codec for one prepared Session turn execution. */

import { sha256Hex } from "../content/sha256";
import type {
  ManagedGenerationPreparedExecution,
  ManagedThreadPublication,
} from "../generation-model/execution-checkpoint";
import {
  assertRuntimeJsonValue,
  cloneRuntimeJsonValue,
} from "../runtime/engine/json-value";
import type { JsonValue } from "../storage";
import type { ThreadMessageInput } from "../thread";

/** Validated private payload stored before owner-Thread publication. */
export interface PreparedSessionTurn {
  readonly output: JsonValue;
  readonly publication: ManagedThreadPublication;
  readonly preparationDecisionIds: readonly string[];
}

/** Encode prepared evidence through the Runtime JSON contract. */
export function encodePreparedSessionTurn(
  workId: string,
  prepared: ManagedGenerationPreparedExecution,
): { readonly payload: JsonValue; readonly prepared: PreparedSessionTurn } {
  if (!prepared.publication) {
    throw new TypeError(
      "Session execution requires a prepared Thread publication.",
    );
  }
  const messages = prepared.publication.messages.map((message, index) => ({
    id: message.id ?? messageId(workId, index),
    role: message.role,
    content: message.content,
    ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
  }));
  const candidate: unknown = {
    schema: 1,
    output: prepared.output,
    publication: {
      threadId: prepared.publication.threadId,
      after: prepared.publication.after ?? null,
      messages,
    },
    preparationDecisionIds: [...prepared.preparationDecisionIds],
  };
  assertRuntimeJsonValue(candidate, "Session prepared execution");
  const payload = cloneRuntimeJsonValue(candidate, "Session prepared execution");
  return { payload, prepared: parsePreparedSessionTurn(payload) };
}

/** Validate a prepared execution payload loaded from private Runtime storage. */
export function parsePreparedSessionTurn(payload: JsonValue): PreparedSessionTurn {
  if (!isRecord(payload) || payload.schema !== 1 || !("output" in payload)) {
    throw invalidPreparedExecution();
  }
  const publication = payload.publication;
  const decisionIds = payload.preparationDecisionIds;
  if (
    !isRecord(publication) ||
    typeof publication.threadId !== "string" ||
    (publication.after !== null && typeof publication.after !== "string") ||
    !Array.isArray(publication.messages) ||
    !publication.messages.every(isThreadMessage) ||
    !Array.isArray(decisionIds) ||
    !decisionIds.every((id) => typeof id === "string")
  ) {
    throw invalidPreparedExecution();
  }
  assertRuntimeJsonValue(payload.output, "Session prepared execution output");
  return Object.freeze({
    output: payload.output,
    publication: Object.freeze({
      threadId: publication.threadId,
      ...(publication.after ? { after: publication.after } : {}),
      messages: Object.freeze(publication.messages as ThreadMessageInput[]),
    }),
    preparationDecisionIds: Object.freeze([...decisionIds]),
  });
}

function messageId(workId: string, index: number): string {
  return `msg_${sha256Hex(new TextEncoder().encode(`${workId}:${index}`)).slice(0, 32)}`;
}

function isThreadMessage(value: unknown): value is ThreadMessageInput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" ||
      value.role === "assistant" ||
      value.role === "system" ||
      value.role === "tool") &&
    "content" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPreparedExecution(): TypeError {
  return new TypeError("Stored Session prepared execution is malformed.");
}
