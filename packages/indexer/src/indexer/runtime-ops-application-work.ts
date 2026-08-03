import type {
  FlowSnapshot,
  ResolvedRuntimeEngine,
  RuntimeWorkItem,
} from "@use-crux/core/runtime";
import type { RuntimeApplicationWorkInspect } from "./runtime-ops-types";

const MAX_INSPECT_EVENTS = 200;

/** Build the bounded, result-free application Work detail read model. */
export async function inspectApplicationWork(
  runtime: ResolvedRuntimeEngine,
  work: RuntimeWorkItem,
  snapshot: FlowSnapshot,
): Promise<RuntimeApplicationWorkInspect> {
  const events = await runtime.store.events.read({
    namespace: runtime.namespace,
    name: `crux.work:${work.workId}`,
    limit: MAX_INSPECT_EVENTS,
  });
  return {
    ...(snapshot.inputDigest ? { inputDigest: snapshot.inputDigest } : {}),
    ...(snapshot.definition ? { definition: snapshot.definition } : {}),
    ...(snapshot.effects ? { effects: snapshot.effects } : {}),
    ownership: work.application!.ownership,
    ...(work.application!.statistics
      ? { statistics: work.application!.statistics }
      : {}),
    result: {
      available: work.resultRef !== undefined,
      ...(work.resultRef ? { ref: work.resultRef } : {}),
    },
    events: events.events,
  };
}
