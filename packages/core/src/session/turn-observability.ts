/** Existing observability-path evidence for durable Session turns. */

import {
  hasActiveObservabilitySinks,
  observe,
  propagateAttributes,
  type OpenObservedRun,
} from "../observability/observe";
import type { CruxSessionTurnAttributes } from "../observability/contract";
import type { RuntimeStoreAdapter } from "../runtime/store";
import { resolveRecords } from "../runtime/runtime";
import type { RuntimeWorkItem } from "../runtime/engine/work";
import { readSessionRuntimeReadModel } from "./runtime-read-model";

type SessionTurnOutcome = NonNullable<CruxSessionTurnAttributes["outcome"]>;

export interface SessionTurnObservability {
  /** Execute under the Session run so nested generation evidence retains lineage. */
  withContext<T>(execute: () => T | Promise<T>): T | Promise<T>;
  /** Close the run after durable settlement using the latest safe read model. */
  settle(outcome: SessionTurnOutcome): Promise<void>;
}

/** Open one canonical run for leased Session Work. */
export function openSessionTurnObservability(
  work: RuntimeWorkItem,
  store: RuntimeStoreAdapter,
): SessionTurnObservability | undefined {
  if (work.work.kind !== "session.turn" || !hasActiveObservabilitySinks()) {
    return undefined;
  }
  const turn = work.work;
  const attributes: CruxSessionTurnAttributes = {
    sessionId: turn.sessionId,
    inputId: turn.inputId,
    workId: work.workId,
    cursor: String(turn.cursor),
    threadId: turn.threadId,
  };
  const run = propagateAttributes({ sessionId: turn.sessionId }, () =>
    observe.openRun({
      name: "session turn",
      rootPrimitive: "session.turn",
      attributes,
    }),
  );
  return evidence(run, store, work.namespace, turn.sessionId, attributes);
}

function evidence(
  run: OpenObservedRun,
  store: RuntimeStoreAdapter,
  namespace: string,
  sessionId: string,
  attributes: CruxSessionTurnAttributes,
): SessionTurnObservability {
  return Object.freeze({
    withContext: <T>(execute: () => T | Promise<T>) => run.withContext(execute),
    settle: async (outcome: SessionTurnOutcome) => {
      let session;
      try {
        session = await readSessionRuntimeReadModel(
          { namespace, store },
          sessionId,
          { records: resolveRecords() },
        );
      } catch {
        // Diagnostics must never alter durable execution settlement.
      }
      run.end({
        status: runStatus(outcome),
        attributes: { ...attributes, outcome, ...(session ? { session } : {}) },
      });
    },
  });
}

function runStatus(
  outcome: SessionTurnOutcome,
): "ok" | "blocked" | "cancelled" | "error" {
  if (outcome === "completed") return "ok";
  if (outcome === "blocked") return "blocked";
  if (outcome === "cancelled") return "cancelled";
  return "error";
}
