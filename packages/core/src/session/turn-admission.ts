/** Atomic Session-input to canonical-Work admission. */

import type { AnyAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { initialApplicationWorkState } from "../runtime/engine/application-work-state";
import { wakeEnvelopeForWork } from "../runtime/engine/kernel-shared";
import type { RuntimeWorkItem } from "../runtime/engine/work";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { RuntimeTargetId } from "../runtime/ports/ids";
import type { JsonValue } from "../storage";
import type { SessionTurnHandle } from "./types";
import { durableWorkHandle } from "../work/internal/durable-handle";
import { sessionTurnIdentity } from "./turn-identity";

/** Accept validated inputs and their runnable Work occurrences atomically. */
export async function acceptSessionTurns<TOutput>(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  target: AnyAgent,
  model: GenerationModel,
  inputs: readonly JsonValue[],
): Promise<readonly SessionTurnHandle<TOutput>[]> {
  const admitted = await runtime.store.transact(async (tx) => {
    const sessions = tx.sessions;
    if (!sessions) throw new Error("Runtime Session storage is unavailable.");
    const accepted = await sessions.acceptInputs({
      namespace: runtime.namespace,
      sessionId: record.sessionId,
      inputs,
      now: runtime.now(),
    });
    const turns: Array<{
      readonly accepted: (typeof accepted)[number];
      readonly work: RuntimeWorkItem;
    }> = [];
    for (const input of accepted) {
      const identity = sessionTurnIdentity(
        runtime.namespace,
        record.sessionId,
        input.inputId,
      );
      const created = await tx.state.createWork({
        workId: identity.workId,
        namespace: runtime.namespace,
        work: {
          kind: "session.turn",
          sessionId: record.sessionId,
          inputId: input.inputId,
          cursor: input.cursor,
          threadId: record.threadId,
          input: input.input,
          model: {
            definitionId: model.definition.id,
            fingerprint: model.definition.fingerprint,
          },
        },
        targetId: target.id as RuntimeTargetId,
        idempotencyKey: `session.turn:${identity.workId}`,
        now: runtime.now(),
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
      await sessions.linkTurn({
        namespace: runtime.namespace,
        sessionId: record.sessionId,
        inputId: input.inputId,
        workId: work.workId,
        target: target.id,
        now: runtime.now(),
      });
      await tx.outbox.put(wakeEnvelopeForWork(work), {
        deliverAt: runtime.now(),
      });
      turns.push({ accepted: input, work });
    }
    return turns;
  });
  return Object.freeze(
    admitted.map(({ accepted, work }) => {
      const canonical = durableWorkHandle<TOutput>(runtime, work);
      return Object.freeze({
        id: accepted.inputId,
        cursor: String(accepted.cursor),
        acceptedAt: new Date(accepted.acceptedAt),
        work: canonical,
        result: canonical.result,
      });
    }),
  );
}
