import { config, createWorkHost } from "@use-crux/core";
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import type { AnyAgent } from "@use-crux/core/agent";
import { defineGenerationModel } from "../../src/adapter-authoring";

export const sessionTestModel = defineGenerationModel({
  adapter: { id: "test", version: "1" },
  native: Object.freeze({ id: "session-test-model" }),
  definition: { id: "test:session-test-model", fingerprint: "session-test-v1" },
  identity: { kind: "model", model: "session-test-model" },
  capabilities: {
    contract: "crux.generation-capabilities.v1",
    language: ["text-input", "text-output", "structured-output"],
    embedding: [], image: [], speech: [], transcription: [],
  },
  runtime: { createAgentExecutor: () => async () => ({}) },
});

interface SessionHostOptions {
  readonly store?: ReturnType<typeof inMemoryRuntimeStore>;
  readonly records?: ReturnType<typeof inMemoryRecordStore>;
  readonly targets: readonly AnyAgent[];
}

export function sessionHost(
  namespace: string,
  options: SessionHostOptions,
) {
  const store = options.store ?? inMemoryRuntimeStore();
  const records = options.records ?? inMemoryRecordStore();
  config({ storage: { records } });
  return {
    host: createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({
        targets: options.targets,
        generationModels: [sessionTestModel],
        transports: [],
      }),
    }),
    records,
    store,
  };
}
