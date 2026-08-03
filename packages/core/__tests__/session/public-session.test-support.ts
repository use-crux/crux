import { config, createWorkHost } from "@use-crux/core";
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";

export function sessionHost(
  namespace: string,
  store = inMemoryRuntimeStore(),
  records = inMemoryRecordStore(),
) {
  config({ storage: { records } });
  return {
    host: createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
    }),
    records,
    store,
  };
}
