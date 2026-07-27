/** Run-owned observability capture used to derive per-cell Eval signals. */

import { observe } from "../../observability";
import type { CruxGraphRecord } from "../../observability/contract";
import type { EvalCaptureSession } from "./capture-context";
import { recordEvalCellObservation } from "./cell-observation";

/** Create one capture bucket shared by every cell in an Eval run. @internal */
export function installSignalCapture(): EvalCaptureSession {
  const byRun = new Map<string, CruxGraphRecord[]>();
  return Object.freeze({
    send(records: readonly CruxGraphRecord[]) {
      recordEvalCellObservation(records);
      for (const record of records) {
        const bucket = byRun.get(record.runId);
        if (bucket) bucket.push(record);
        else byRun.set(record.runId, [record]);
      }
    },
    take(runId: string) {
      return collectTriggeredRunClosure(byRun, runId);
    },
    async settle() {
      // The tee is synchronous when the queue dispatches. A short flush also
      // covers microtask-async emitters without waiting on dead transports.
      await observe.flush({ timeoutMs: 250 });
    },
    dispose() {
      byRun.clear();
    },
  } satisfies EvalCaptureSession);
}

/** Collect one cell run and every run transitively linked by `triggered`. */
export function collectTriggeredRunClosure(
  byRun: ReadonlyMap<string, readonly CruxGraphRecord[]>,
  rootRunId: string,
): CruxGraphRecord[] {
  const visited = new Set<string>();
  const ordered: CruxGraphRecord[] = [];
  const queue = [rootRunId];

  while (queue.length > 0) {
    const runId = queue.shift()!;
    if (visited.has(runId)) continue;
    visited.add(runId);

    const records = byRun.get(runId) ?? [];
    for (const record of records) {
      ordered.push(record);
      if (record.type !== "edge" || record.edgeType !== "triggered") continue;
      if (record.to.kind !== "run") continue;
      const childRunId = record.to.id;
      if (
        typeof childRunId === "string" &&
        childRunId.length > 0 &&
        !visited.has(childRunId)
      ) {
        queue.push(childRunId);
      }
    }
  }

  return ordered;
}
