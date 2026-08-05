/** Atomic reservation of the next Session activation on the canonical Work spine. */

import { sha256Hex } from "../../../content/sha256";
import type { JsonValue } from "../../../storage";
import type { RuntimeStoreTransaction } from "../../store";
import { initialApplicationWorkState } from "../application-work-state";
import { appendApplicationWorkStatusEvent } from "../application-work-events";
import { wakeEnvelopeForWork } from "../kernel-shared";
import { sessionTurnIdentity } from "../session-turn-identity";
import type { RuntimeWorkItem } from "../work";
import type { FlowId, RuntimeTargetId } from "../../ports/ids";
import type { FlowSnapshot } from "../../ports/state";
import type { RuntimeSessionRecord } from "../../ports/sessions";

const encoder = new TextEncoder();

/** Reserve and enqueue the next unprocessed input when no activation exists. */
export async function reserveNextSessionActivation(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly now: Date;
  },
): Promise<RuntimeWorkItem | null> {
  const sessions = tx.sessions;
  if (!sessions) throw new Error("Runtime Session storage is unavailable.");
  const session = await sessions.get(input.namespace, input.sessionId);
  if (!session || session.activation) return null;
  const cursor = (session.processedCursor ?? 0) + 1;
  const accepted = await sessions.getInputAtCursor(
    input.namespace,
    input.sessionId,
    cursor,
  );
  if (!accepted) return null;
  const identity = sessionTurnIdentity(
    input.namespace,
    input.sessionId,
    accepted.inputId,
  );
  await sessions.reserveTurn({
    namespace: input.namespace,
    sessionId: input.sessionId,
    inputId: accepted.inputId,
    workId: identity.workId,
    target: session.targetId,
    now: input.now,
  });
  if (session.targetKind === "flow") {
    return reserveFlowActivation(tx, session, accepted.input, identity, input.now);
  }
  if (!session.model) {
    throw new Error(
      `Agent Session "${session.sessionId}" is missing its pinned GenerationModel.`,
    );
  }
  const created = await tx.state.createWork({
    workId: identity.workId,
    namespace: input.namespace,
    work: {
      kind: "session.turn",
      sessionId: session.sessionId,
      inputId: accepted.inputId,
      cursor: accepted.cursor,
      threadId: session.threadId,
      input: accepted.input,
      model: session.model,
    },
    targetId: session.targetId as RuntimeTargetId,
    idempotencyKey: `session.turn:${identity.workId}`,
    now: input.now,
  });
  const work = Object.freeze({
    ...created,
    application: initialApplicationWorkState(
      created.workId,
      created.createdAt,
      identity.effects,
    ),
  });
  await tx.state.putWork(work);
  await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: input.now });
  return work;
}

async function reserveFlowActivation(
  tx: RuntimeStoreTransaction,
  session: RuntimeSessionRecord,
  input: JsonValue,
  identity: ReturnType<typeof sessionTurnIdentity>,
  now: Date,
): Promise<RuntimeWorkItem> {
  if (!session.definition) {
    throw new Error(
      `Flow Session "${session.sessionId}" is missing its pinned target definition.`,
    );
  }
  const existing = await tx.state.getWork(identity.workId, {
    namespace: session.namespace,
  });
  if (existing) return existing;
  const created = await tx.state.createWork({
    workId: identity.workId,
    namespace: session.namespace,
    work: { kind: "flow.resume", flowId: identity.flowId },
    targetId: session.targetId as RuntimeTargetId,
    idempotencyKey: `session.flow:${identity.workId}`,
    now,
  });
  const work = await appendApplicationWorkStatusEvent(
    tx,
    Object.freeze({
      ...created,
      application: initialApplicationWorkState(
        created.workId,
        created.createdAt,
        identity.effects,
      ),
    }),
  );
  await tx.state.putWork(work);
  const snapshot: FlowSnapshot = Object.freeze({
    flowId: identity.flowId as FlowId,
    workId: identity.workId,
    targetId: session.targetId as RuntimeTargetId,
    definition: session.definition,
    resultObligation: Object.freeze({ kind: "required" as const }),
    namespace: session.namespace,
    status: "running",
    effects: identity.effects,
    input,
    inputDigest: sha256Hex(encoder.encode(canonicalJson(input))),
    completedSteps: Object.freeze({}),
    fingerprint: Object.freeze([]),
    pendingSuspends: Object.freeze([]),
    scheduledWork: Object.freeze({}),
    updatedAt: now,
  });
  await tx.state.putSnapshot(snapshot);
  await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now });
  return work;
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue | undefined>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return JSON.stringify(value);
}
