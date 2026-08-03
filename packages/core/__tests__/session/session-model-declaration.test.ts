import { afterEach, describe, expect, it, vi } from "vitest";
import {
  config,
  createWorkHost,
  GenerationModelNotStaticError,
  prompt,
  resetHooks,
  session,
} from "@use-crux/core";
import { agent } from "@use-crux/core/agent";
import { defineGenerationModel } from "../../src/adapter-authoring";
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { z } from "zod";

afterEach(() => resetHooks());

describe("Session model declaration", () => {
  it("rejects a bound override absent from the RuntimeProgram before mutation", async () => {
    const makeModel = (id: string) =>
      defineGenerationModel({
        adapter: { id: "test", version: "1" },
        native: Object.freeze({ id }),
        definition: { id: `test:${id}`, fingerprint: `${id}-v1` },
        identity: { kind: "model" as const, model: id },
        capabilities: {
          contract: "crux.generation-capabilities.v1" as const,
          language: ["text-input", "text-output", "structured-output"],
          embedding: [],
          image: [],
          speech: [],
          transcription: [],
        },
        runtime: { createAgentExecutor: () => async () => ({}) },
      });
    const declared = makeModel("declared");
    const override = makeModel("override");
    const support = agent({
      id: "session-model-declaration",
      model: declared,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        prompt: ({ input }) => input.message,
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-model-declaration";
    const put = vi.spyOn(records, "put");
    const create = vi.spyOn(records, "create");
    const mutate = vi.spyOn(records, "mutate");
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({
        targets: [support],
        generationModels: [declared],
        transports: [],
      }),
    });

    try {
      const error = await host
        .run(() => session(support, { key: "customer", model: override }))
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(GenerationModelNotStaticError);
      expect(error).toMatchObject({ code: "GENERATION_MODEL_NOT_STATIC" });
      expect(store.testing.sessionRecords(namespace)).toEqual([]);
      expect(await store.state.listWork({ namespace, status: "pending" })).toEqual([]);
      expect(put).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      host.dispose();
    }
  });
});
