import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { prompt } from "@use-crux/core";
import { describe, expect, it } from "vitest";
import { createGoogle } from "../src";

describe("Google stream completion", () => {
  it("preserves exact mixed order and canonical messages", async () => {
    const client = {
      models: { generateContentStream: async () => stream() },
    } as unknown as GoogleGenAI;
    const result = await createGoogle(client, { cachedContent: false }).stream(
      prompt({ id: "google-stream-content", prompt: "Inspect this." }),
      { model: "gemini-mixed" },
    );

    for await (const _ of result.textStream) {
      /* consume */
    }
    const completion = await result.completion;

    expect(completion.content.map((part) => part.type)).toEqual([
      "text",
      "audio",
      "tool-call",
      "video",
    ]);
    expect(completion.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: completion.content,
    });
  });
});

async function* stream(): AsyncIterable<GenerateContentResponse> {
  yield {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "Listen" },
            { inlineData: { data: "AQID", mimeType: "audio/wav" } },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
  yield {
    modelVersion: "gemini-mixed-actual",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          role: "model",
          parts: [
            {
              functionCall: { id: "tc_1", name: "inspect", args: { page: 1 } },
            },
            {
              fileData: {
                fileUri: "https://example.test/video.mp4",
                mimeType: "video/mp4",
              },
            },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
}
