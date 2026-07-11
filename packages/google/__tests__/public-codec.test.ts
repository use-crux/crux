import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { fromResponse, toParams } from "../src";
import type { GenerateContentResponse } from "@google/genai";

describe("public Google codecs", () => {
  it("turns a resolved prompt into Google params and normalizes the response", async () => {
    const p = prompt({
      id: "google-codec-test",
      system: "Speak plainly.",
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
      settings: { temperature: 0.2 },
    });

    const resolved = await p.resolve({
      input: { word: "hello" },
      provider: "google",
      modelId: "gemini-codec",
    });
    const params = await toParams(resolved, {
      model: "gemini-codec",
      settings: { maxTokens: 123 },
    });

    expect(params).toMatchObject({
      model: "gemini-codec",
      contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
      config: {
        systemInstruction: "Speak plainly.",
        temperature: 0.2,
        maxOutputTokens: 123,
      },
    });

    const facts = fromResponse({
      text: "hello",
      modelVersion: "gemini-codec-actual",
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "hello" }] } },
      ],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 4,
        totalTokenCount: 7,
      },
    } as GenerateContentResponse);

    expect(facts).toMatchObject({
      text: "hello",
      finishReason: "stop",
      actualModelId: "gemini-codec-actual",
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
  });

  it("preserves mixed assistant order and semantic audio/video kinds", () => {
    const facts = fromResponse({
      modelVersion: "gemini-mixed",
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { text: "Listen: " },
              { inlineData: { data: "YXVkaW8=", mimeType: "audio/wav" } },
              {
                functionCall: {
                  id: "tc_1",
                  name: "inspect",
                  args: { frame: 1 },
                },
              },
              {
                fileData: {
                  fileUri: "https://example.test/clip.mp4",
                  mimeType: "video/mp4",
                },
              },
            ],
          },
        },
      ],
    } as GenerateContentResponse);

    expect(facts.content?.map((part) => part.type)).toEqual([
      "text",
      "audio",
      "tool-call",
      "video",
    ]);
    expect(facts.toolCalls).toEqual([
      { id: "tc_1", name: "inspect", args: { frame: 1 } },
    ]);
  });
});
