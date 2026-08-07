/** Atomic Session-input to canonical-Work admission. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { JsonValue } from "../storage";
import type { SessionTurnHandle } from "./types";
import { durableWorkHandle } from "../work/internal/durable-handle";
import { waitForDurableWorkChange } from "../work/internal/durable-wait";

import { assertSessionAcceptsIngress } from "./lifecycle";

/** Accept validated inputs and reserve at most one runnable activation Work. */
export async function acceptSessionTurns<TOutput>(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  inputs: readonly JsonValue[],
): Promise<readonly SessionTurnHandle<TOutput>[]> {
  const sessions = runtime.store.sessions;
  const latest = sessions
    ? await sessions.get(runtime.namespace, record.sessionId)
    : null;
  assertSessionAcceptsIngress(latest ?? record);
  const accepted = await runtime.kernel.acceptSessionInputs({
    namespace: runtime.namespace,
    session: {
      sessionId: record.sessionId,
      keyHash: record.keyHash,
      targetId: record.targetId,
      threadId: record.threadId,
    },
    inputs,
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
