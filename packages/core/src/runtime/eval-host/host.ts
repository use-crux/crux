import { inMemoryRuntimeStore } from "../adapters/memory";
import { node } from "../composers/node";
import { createResolvedEvalHost } from "./runtime";
import type { CreateMemoryEvalHostOptions, MemoryEvalHost } from "./types";
import { assertEvalHostEntry } from "./setup";

/** Create the process-local V2 reference host with strict V1 read support. */
export function createMemoryEvalHost(
  options: CreateMemoryEvalHostOptions,
): MemoryEvalHost {
  assertEvalHostEntry(options);
  const store = inMemoryRuntimeStore();
  const resolved = createResolvedEvalHost({
    ...options,
    runtime: node({ store, autoStartMaintenance: false }),
    hostKind: "memory",
    wakeMode: "background",
  });
  return Object.freeze({ store, fetch: resolved.fetch });
}
