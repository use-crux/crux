import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { prompt } from "@use-crux/core";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

function model(id = "test-model", provider = "openai"): LanguageModel {
  return {
    provider,
    modelId: id,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

const textPrompt = prompt({
  id: "ai-stream-project-step-messages",
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
});

describe("stream() projectStepMessages bridge", () => {
  it("forwards projectStepMessages into sealed stream planning and keeps it out of provider settings", async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ["ok"], finish: { text: "ok" } }],
    });
    const projectStepMessages = vi.fn(async () => [
      {
        role: "user" as const,
        content: "stream steering",
        metadata: { provenance: "agent-steering" as const },
      },
    ]);

    const result = await createCruxAi({ gateway: scripted.gateway }).stream(
      textPrompt,
      {
        model: model(),
        input: { message: "start" },
        projectStepMessages,
      },
    );

    let text = "";
    for await (const delta of result.textStream as AsyncIterable<string>) {
      text += delta;
    }
    await result.completion;

    expect(text).toBe("ok");
    expect(projectStepMessages).toHaveBeenCalled();
    expect(scripted.calls.streamText).toHaveLength(1);

    const streamArgs = scripted.calls.streamText[0]!;
    expect(streamArgs).not.toHaveProperty("projectStepMessages");
    expect(JSON.stringify(streamArgs)).not.toContain("projectStepMessages");

    // The real AI SDK invokes prepareStep before the first provider call.
    // Scripted gateway records the raw args, so exercise that boundary here.
    const prepareStep = streamArgs.prepareStep as
      | ((input: {
          model: LanguageModel;
          messages: Array<{ role: string; content: unknown }>;
        }) => Promise<{ messages?: unknown } | undefined>)
      | undefined;
    expect(typeof prepareStep).toBe("function");
    const planned = await prepareStep!({
      model: model(),
      messages: [{ role: "user", content: "start" }],
    });

    expect(planned?.messages).toEqual([
      { role: "user", content: "start" },
      { role: "user", content: "stream steering" },
    ]);
  });
});
