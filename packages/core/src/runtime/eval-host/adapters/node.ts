import { inMemoryRuntimeStore } from "../../adapters/memory";
import { node } from "../../composers/node";
import { createResolvedEvalHost } from "../runtime";
import type {
  CreateNodeEvalHostOptions,
  EvalHostFetchHandler,
  EvalHostStore,
} from "../types";
import { assertEvalHostEntry, assertEvalHostStore } from "../setup";

/** Create an in-process Node host using the existing Node Runtime composer. */
export function createNodeEvalHost(
  options: CreateNodeEvalHostOptions,
): EvalHostFetchHandler {
  assertEvalHostEntry(options);
  const store: EvalHostStore = options.store ?? inMemoryRuntimeStore();
  assertEvalHostStore(store);
  const resolved = createResolvedEvalHost({
    ...options,
    runtime: node({ store, autoStartMaintenance: false }),
    hostKind: "node",
    wakeMode: "background",
  });
  return Object.freeze({ fetch: resolved.fetch });
}
