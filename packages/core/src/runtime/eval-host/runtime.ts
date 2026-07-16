import { createRuntime } from "../api/create-runtime";
import type { ResolvedRuntimeEngine } from "../api/create-runtime";
import type { InProcessRuntimeEngineDefinition } from "../api/runtime-definition";
import type { WorkId } from "../ports/ids";
import type { RuntimeWakeDeliver } from "../engine/outbox";
import { createEvalExecuteTarget, EVAL_EXECUTE_TARGET_ID } from "./target";
import type {
  CreateEvalHostOptions,
  EvalHostFetchHandler,
  EvalHostKind,
  EvalHostStore,
} from "./types";
import { createEvalHostRequestHandler } from "./request-handler";
import { assertEvalHostEntry, assertEvalHostStore } from "./setup";

/** Whether admission can await durable wake acceptance before responding. */
export type EvalHostWakeMode = "background" | "durable";

/** Fully resolved private host used by concrete platform adapters. */
export interface ResolvedEvalHost<
  TStore extends EvalHostStore,
> extends EvalHostFetchHandler {
  readonly runtime: ResolvedRuntimeEngine<TStore>;
}

/** Resolve one concrete Runtime composer into the shared Eval host protocol. */
export function createResolvedEvalHost<TStore extends EvalHostStore>(
  options: CreateEvalHostOptions & {
    readonly runtime: InProcessRuntimeEngineDefinition<TStore>;
    readonly hostKind: EvalHostKind;
    readonly wakeMode: EvalHostWakeMode;
  },
): ResolvedEvalHost<TStore> {
  assertEvalHostEntry(options);
  assertEvalHostStore(options.runtime.store);
  const now = options.now ?? options.runtime.now ?? (() => new Date());
  let generatedId = 0;
  const target = createEvalExecuteTarget({
    registry: options.registry,
    store: options.runtime.store,
    now,
  });
  const runtime = createRuntime({
    runtime: options.runtime,
    namespace: `eval-host:${options.deploymentId}`,
    targets: { [EVAL_EXECUTE_TARGET_ID]: target },
    newWorkId: () => `eval-host-internal:${++generatedId}` as WorkId,
    now,
    startMaintenance: false,
  });
  const scheduleWake = wakeScheduler(runtime, options.wakeMode);
  const handler = createEvalHostRequestHandler({
    ...options,
    store: options.runtime.store,
    kernel: runtime.kernel,
    namespace: runtime.namespace,
    hostKind: options.hostKind,
    now,
    scheduleWake,
  });
  return Object.freeze({ runtime, fetch: handler.fetch });
}

function wakeScheduler(
  runtime: ResolvedRuntimeEngine<EvalHostStore>,
  mode: EvalHostWakeMode,
): RuntimeWakeDeliver {
  if (mode === "durable") return (envelope) => runtime.deliver(envelope);
  return (envelope) => {
    queueMicrotask(() => {
      void runtime.deliver(envelope);
    });
    return Promise.resolve();
  };
}
