/** Atomic reservation of the next Session activation on the canonical Work spine. */

import type { RuntimeStoreTransaction } from "../../store";
import { initialApplicationWorkState } from "../application-work-state";
import { wakeEnvelopeForWork } from "../kernel-shared";
import { sessionTurnIdentity } from "../session-turn-identity";
import type { RuntimeWorkItem } from "../work";
import type { RuntimeTargetId } from "../../ports/ids";

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
