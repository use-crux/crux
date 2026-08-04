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
import type { ThreadHistoryRange } from "../request/history/source";
import type { PreparationDecisionInspection } from "../request/prepare/journal";

interface EncodedPreparationDecision {
  readonly operation: "language";
  readonly stepIndex: number;
  readonly reason: PreparationDecisionInspection["reason"];
  readonly amendment: Omit<
    PreparationDecisionInspection["amendment"],
    "activeTools"
  > & { readonly activeTools: number | null };
  readonly resources: PreparationDecisionInspection["resources"];
  readonly sealedRequestId: string;
}

/** Validated private payload stored before owner-Thread publication. */
export interface PreparedSessionTurn {
  readonly output: JsonValue;
  readonly publication: ManagedThreadPublication;
  readonly preparationDecisions: readonly PreparationDecisionInspection[];
}

/** Encode prepared evidence through the Runtime JSON contract. */
export function encodePreparedSessionTurn(
  workId: string,
  prepared: ManagedGenerationPreparedExecution,
): { readonly payload: JsonValue; readonly prepared: PreparedSessionTurn } {
  if (!prepared.publication?.basis) {
    throw new TypeError(
      "Session execution requires a prepared exact Thread basis.",
    );
  }
  const messages = prepared.publication.messages.map((message, index) => ({
    id: message.id ?? messageId(workId, index),
    role: message.role,
    content: message.content,
    ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
  }));
  const candidate: unknown = {
    schema: 2,
    output: prepared.output,
    publication: {
      threadId: prepared.publication.threadId,
      after: prepared.publication.after ?? null,
      messages,
      basis: prepared.publication.basis,
    },
    preparationDecisions: prepared.preparationDecisions.map(encodeDecision),
  };
  assertRuntimeJsonValue(candidate, "Session prepared execution");
  const payload = cloneRuntimeJsonValue(
    candidate,
    "Session prepared execution",
  );
  return { payload, prepared: parsePreparedSessionTurn(payload) };
}

/** Validate a prepared execution payload loaded from private Runtime storage. */
export function parsePreparedSessionTurn(
  payload: JsonValue,
): PreparedSessionTurn {
  if (!isRecord(payload) || payload.schema !== 2 || !("output" in payload)) {
    throw invalidPreparedExecution();
  }
  const publication = payload.publication;
  const decisions = payload.preparationDecisions;
  if (
    !isRecord(publication) ||
    typeof publication.threadId !== "string" ||
    (publication.after !== null && typeof publication.after !== "string") ||
    !Array.isArray(publication.messages) ||
    !publication.messages.every(isThreadMessage) ||
    !isThreadBasis(publication.basis) ||
    !Array.isArray(decisions) ||
    !decisions.every(isPreparationDecision)
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
      basis: freezeThreadBasis(publication.basis),
    }),
    preparationDecisions: Object.freeze(decisions.map(freezeDecision)),
  });
}

function encodeDecision(decision: PreparationDecisionInspection) {
  return {
    operation: decision.operation,
    stepIndex: decision.stepIndex,
    reason: decision.reason,
    amendment: {
      ...decision.amendment,
      ...(decision.amendment.activeTools === undefined
        ? { activeTools: null }
        : {}),
    },
    resources: decision.resources.map((resource) => ({ ...resource })),
    sealedRequestId: decision.sealedRequestId,
  };
}

function isThreadBasis(value: unknown): value is ThreadHistoryRange {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.revision === "string" &&
    typeof value.range === "string" &&
    isCount(value.offset) &&
    isCount(value.length) &&
    (value.start === undefined || typeof value.start === "string") &&
    (value.end === undefined || typeof value.end === "string")
  );
}

function isPreparationDecision(
  value: unknown,
): value is EncodedPreparationDecision {
  if (!isRecord(value) || !isRecord(value.amendment)) return false;
  return (
    value.operation === "language" &&
    isCount(value.stepIndex) &&
    (value.reason === "initial" ||
      value.reason === "tool-result" ||
      value.reason === "validation-retry") &&
    isCount(value.amendment.addedContributors) &&
    isCount(value.amendment.removedContributors) &&
    isCount(value.amendment.contributedTools) &&
    (value.amendment.activeTools === null ||
      isCount(value.amendment.activeTools)) &&
    typeof value.amendment.modelChanged === "boolean" &&
    typeof value.amendment.inputBudgetChanged === "boolean" &&
    Array.isArray(value.resources) &&
    value.resources.every(isResourceRead) &&
    typeof value.sealedRequestId === "string"
  );
}

function isResourceRead(
  value: unknown,
): value is PreparationDecisionInspection["resources"][number] {
  return (
    isRecord(value) &&
    typeof value.identity === "string" &&
    typeof value.revision === "string" &&
    typeof value.valueHash === "string"
  );
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function freezeThreadBasis(basis: ThreadHistoryRange): ThreadHistoryRange {
  return Object.freeze({ ...basis });
}

function freezeDecision(
  decision: EncodedPreparationDecision,
): PreparationDecisionInspection {
  return Object.freeze({
    ...decision,
    amendment: Object.freeze({
      ...decision.amendment,
      activeTools:
        decision.amendment.activeTools === null
          ? undefined
          : decision.amendment.activeTools,
    }),
    resources: Object.freeze(
      decision.resources.map((resource) => Object.freeze({ ...resource })),
    ),
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
