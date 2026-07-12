import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { boundary } from "@use-crux/core/safety";
import { guardrail, prompt } from "@use-crux/core";
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

  it("keeps every original text slot around media after safety rewrites", async () => {
    const client = {
      models: { generateContentStream: async () => safetyStream() },
    } as unknown as GoogleGenAI;
    const result = await createGoogle(client, { cachedContent: false }).stream(
      prompt({ id: "google-stream-safe-order", prompt: "Inspect this." }),
      {
        model: "gemini-mixed",
        guardrails: [
          guardrail({
            id: "rewrite-unsafe-slots",
            on: boundary.output.text(),
            stream: "chunk",
            run: async (text) => ({
              action: "rewrite" as const,
              value: text.replace("unsafe", "safe"),
              rewrite: { kind: "redact" as const },
            }),
          }),
        ],
      },
    );

    let emitted = "";
    for await (const delta of result.textStream) emitted += delta;
    const completion = await result.completion;

    expect(emitted).toBe("safe-Asafe-B");
    expect(completion.text).toBe(emitted);
    expect(completion.content).toEqual([
      { type: "text", text: "safe-A" },
      expect.objectContaining({ type: "image" }),
      { type: "text", text: "safe-B" },
    ]);
    expect(completion.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: completion.content,
    });
  });

  it("repartitions changed-length safe text without restoring unsafe provider text", async () => {
    const client = {
      models: { generateContentStream: async () => mismatchedSafetyStream() },
    } as unknown as GoogleGenAI;
    const result = await createGoogle(client, { cachedContent: false }).stream(
      prompt({ id: "google-stream-safe-mismatch", prompt: "Inspect this." }),
      {
        model: "gemini-mixed",
        guardrails: [
          guardrail({
            id: "expand-secret",
            on: boundary.output.text(),
            stream: "chunk",
            run: async (text) => ({
              action: "rewrite" as const,
              value: text.replace("secret", "[REDACTED]"),
              rewrite: { kind: "redact" as const },
            }),
          }),
        ],
      },
    );

    let emitted = "";
    for await (const delta of result.textStream) emitted += delta;
    const completion = await result.completion;
    expect(completion.content).toEqual([
      { type: "text", text: "[REDACTED]" },
      expect.objectContaining({ type: "image" }),
      { type: "text", text: "AB" },
    ]);
    expect(
      completion.content.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ).join(""),
    ).toBe(emitted);
    expect(JSON.stringify(completion.content)).not.toContain("secret");
  });

  it("keeps zero-length text slots deterministic", async () => {
    const client = {
      models: { generateContentStream: async () => zeroSlotSafetyStream() },
    } as unknown as GoogleGenAI;
    const result = await createGoogle(client, { cachedContent: false }).stream(
      prompt({ id: "google-stream-safe-empty-slot", prompt: "Inspect this." }),
      {
        model: "gemini-mixed",
        guardrails: [
          guardrail({
            id: "rewrite-after-empty-slot",
            on: boundary.output.text(),
            stream: "chunk",
            run: async (text) => ({
              action: "rewrite" as const,
              value: text.replace("unsafe", "safe"),
              rewrite: { kind: "redact" as const },
            }),
          }),
        ],
      },
    );

    for await (const _ of result.textStream) {
      /* consume */
    }
    const completion = await result.completion;
    expect(completion.content).toEqual([
      expect.objectContaining({ type: "text", text: "" }),
      expect.objectContaining({ type: "image" }),
      { type: "text", text: "safe-B" },
    ]);
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

async function* safetyStream(): AsyncIterable<GenerateContentResponse> {
  yield {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "unsafe-A" },
            { inlineData: { data: "AQID", mimeType: "image/png" } },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
  yield {
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: "unsafe-B" }] },
      },
    ],
  } as GenerateContentResponse;
}

async function* mismatchedSafetyStream(): AsyncIterable<GenerateContentResponse> {
  yield {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "secretA" },
            { inlineData: { data: "AQID", mimeType: "image/png" } },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
  yield {
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: "B" }] },
      },
    ],
  } as GenerateContentResponse;
}

async function* zeroSlotSafetyStream(): AsyncIterable<GenerateContentResponse> {
  yield {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "", thoughtSignature: "empty-slot" },
            { inlineData: { data: "AQID", mimeType: "image/png" } },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
  yield {
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: "unsafe-B" }] },
      },
    ],
  } as GenerateContentResponse;
}
