import type OpenAI from "openai";
import { prompt, tool } from "@use-crux/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createOpenAI } from "../src";

describe("OpenAI generated audio", () => {
  it.each([
    ["wav", "audio/wav"],
    ["aac", "audio/aac"],
    ["mp3", "audio/mpeg"],
    ["flac", "audio/flac"],
    ["opus", "audio/opus"],
    ["pcm16", "audio/pcm"],
  ] as const)("preserves %s MIME through managed non-streaming generation", async (format, mediaType) => {
    const create = vi.fn().mockResolvedValue(completion({
      audio: { id: "audio_1", data: "AQID", expires_at: 100, transcript: "Listen" },
    }));

    const result = await createOpenAI(client(create)).generate(
      prompt({ id: `audio-${format}`, prompt: "Say hello." }),
      {
        model: "gpt-audio",
        extra: {
          modalities: ["text", "audio"],
          audio: { format, voice: "alloy" },
        },
      },
    );

    expect(result.content).toContainEqual(expect.objectContaining({
      type: "audio",
      mediaType,
      providerOptions: { openai: { audioFormat: format, audioId: "audio_1" } },
    }));
  });

  it("continues an audio and tool-call response with the native assistant audio id", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({
        audio: { id: "audio_1", data: "AQID", expires_at: 100, transcript: "Listen" },
        toolCall: { id: "call-audio", name: "inspect", args: {} },
      }))
      .mockResolvedValueOnce(completion({ text: "done" }));
    const adapter = createOpenAI(client(create));
    const audioPrompt = prompt({
      id: "audio-tool-continuation",
      tools: {
        inspect: tool({
          description: "Inspect the audio.",
          input: z.object({}),
          execute: async () => "inspected",
        }),
      },
    });

    await adapter.generate(audioPrompt, {
      model: "gpt-audio",
      extra: {
        modalities: ["text", "audio"],
        audio: { format: "pcm16", voice: "alloy" },
      },
    });

    expect(create.mock.calls[1]?.[0].messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      content: "Listen",
      audio: { id: "audio_1" },
      tool_calls: expect.arrayContaining([expect.objectContaining({ id: "call-audio" })]),
    }));
  });
});

function client(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create, parse: vi.fn() } } } as unknown as OpenAI;
}

function completion(options: {
  readonly text?: string;
  readonly audio?: { readonly id: string; readonly data: string; readonly expires_at: number; readonly transcript: string };
  readonly toolCall?: { readonly id: string; readonly name: string; readonly args: unknown };
}) {
  return {
    id: "chatcmpl_audio",
    object: "chat.completion",
    created: 0,
    model: "gpt-audio",
    choices: [{
      index: 0,
      finish_reason: options.toolCall ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content: options.text ?? "Listen",
        ...(options.audio ? { audio: options.audio } : {}),
        ...(options.toolCall
          ? {
              tool_calls: [{
                id: options.toolCall.id,
                type: "function",
                function: { name: options.toolCall.name, arguments: JSON.stringify(options.toolCall.args) },
              }],
            }
          : {}),
      },
    }],
  };
}
