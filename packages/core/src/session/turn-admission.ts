/** Atomic Session-input to canonical-Work admission. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { reserveNextSessionActivation } from "../runtime/engine/composites/session-activation";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { JsonValue } from "../storage";
import type { SessionTurnHandle } from "./types";
import { durableWorkHandle } from "../work/internal/durable-handle";
import { waitForDurableWorkChange } from "../work/internal/durable-wait";

/** Accept validated inputs and reserve at most one runnable activation Work. */
export async function acceptSessionTurns<TOutput>(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  inputs: readonly JsonValue[],
): Promise<readonly SessionTurnHandle<TOutput>[]> {
  const accepted = await runtime.store.transact(async (tx) => {
    const sessions = tx.sessions;
    if (!sessions) throw new Error("Runtime Session storage is unavailable.");
    const appended = await sessions.acceptInputs({
      namespace: runtime.namespace,
      sessionId: record.sessionId,
      inputs,
      now: runtime.now(),
    });
    await reserveNextSessionActivation(tx, {
      namespace: runtime.namespace,
      sessionId: record.sessionId,
      now: runtime.now(),
    });
    return appended;
  });
  return Object.freeze(
    accepted.map((input) => {
      const work = () =>
        resolveInputWork<TOutput>(runtime, record.sessionId, input.inputId);
      return Object.freeze({
        id: input.inputId,
        cursor: String(input.cursor),
        acceptedAt: new Date(input.acceptedAt),
        work,
        result: async () => (await work()).result(),
      });
    }),
  );
}

async function resolveInputWork<TOutput>(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
  inputId: string,
) {
  let waitAttempt = 0;
  for (;;) {
    const accepted = await runtime.store.sessions?.getInput(
      runtime.namespace,
      sessionId,
      inputId,
    );
    if (!accepted) throw new Error(`Session input "${inputId}" was not found.`);
    if (accepted.work) {
      const work = await runtime.store.state.getWork(accepted.work.workId, {
        namespace: runtime.namespace,
      });
      if (!work)
        throw new Error(
          `Session Work "${accepted.work.workId}" was not found.`,
        );
      return durableWorkHandle<TOutput>(runtime, work);
    }
    waitAttempt = await waitForDurableWorkChange(waitAttempt);
  }
}
