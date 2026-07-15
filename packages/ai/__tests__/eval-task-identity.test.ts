import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import {
  executeEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "@use-crux/core/eval/internal/task";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

const model = {
  provider: "test",
  modelId: "scripted-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

describe("managed AI task identity", () => {
  it("projects call and Variant inputs without I/O and returns observed identity", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        system: "Be concise.",
        prompt: "Summarize the supplied topic.",
      }),
      { model, temperature: 0.2 },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);

    const planned = descriptor.projectIdentity({
      phase: "plan",
      input: { topic: "refunds" },
      call: { temperature: 0.7 },
      overrides: { maxTokens: 32 },
    });

    expect(scripted.calls.generateText).toHaveLength(0);
    expect(planned).toMatchObject({ reusable: true });
    expect(planned).not.toEqual(
      descriptor.projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        call: { temperature: 0.4 },
        overrides: { maxTokens: 32 },
      }),
    );

    const execution = await executeEvalTaskForInternalUse(
      task,
      { topic: "refunds" },
      { temperature: 0.7 },
      { maxTokens: 32 },
    );

    expect(scripted.calls.generateText).toHaveLength(1);
    expect(execution.observedIdentity).toEqual(planned);
  });

  it("fails closed for dynamic prompt content instead of source-hashing it", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );

    expect(
      getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).toEqual({ reusable: false, reason: "identity_unavailable" });
  });
});
