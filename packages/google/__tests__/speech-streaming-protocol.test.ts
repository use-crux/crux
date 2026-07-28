import { describe, expect, it } from "vitest";
import { FinishReason } from "@google/genai";
import { createGoogle } from "../src";
import {
  audioChunk,
  clientWith,
  clientWithResponse,
  collect,
  firstAudioChunk,
  PCM_MEDIA_TYPE,
  response,
  terminalResponse,
} from "./speech-streaming.fixture";

describe("Google speech streaming protocol", () => {
  it.each([
    {
      name: "a non-STOP finish reason",
      chunks: [
        firstAudioChunk,
        response({
          candidates: [{ finishReason: FinishReason.OTHER, index: 0 }],
        }),
      ],
      message: 'Google speech generation stopped with reason "OTHER".',
    },
    {
      name: "no terminal response",
      chunks: [firstAudioChunk],
      message: "Google speech stream ended without a STOP terminal response.",
    },
    {
      name: "a missing candidate",
      chunks: [firstAudioChunk, response({ usageMetadata: {} })],
      message: "Google speech stream ended without a STOP terminal response.",
    },
    {
      name: "a changed audio MIME",
      chunks: [
        firstAudioChunk,
        audioChunk("BAUG", "audio/l16; rate=16000; channels=1"),
        terminalResponse,
      ],
      message: "Google speech stream changed audio MIME type between chunks.",
    },
    {
      name: "an invalid base64 audio chunk",
      chunks: [
        firstAudioChunk,
        audioChunk("not base64!", PCM_MEDIA_TYPE),
        terminalResponse,
      ],
      message: "Google speech stream audio chunks must contain valid base64.",
    },
  ])("fails on $name", async ({ chunks, message }) => {
    const { client } = clientWith(chunks);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty("message", message);
    await expect(result.completion).rejects.toBe(error);
  });

  it("publishes no final audio or finish for a non-STOP terminal", async () => {
    const failedTerminal = response({
      candidates: [{ finishReason: FinishReason.OTHER, index: 0 }],
    });
    const { client } = clientWith([firstAudioChunk, failedTerminal]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
    });
    const seen: string[] = [];

    const error = await (async () => {
      try {
        for await (const event of result.fullStream) seen.push(event.type);
      } catch (reason) {
        return reason;
      }
    })();

    expect(seen).toEqual(["start", "audio-delta"]);
    await expect(result.completion).rejects.toBe(error);
  });

  it("fails when a response follows the exact terminal response", async () => {
    const { client } = clientWith([
      firstAudioChunk,
      terminalResponse,
      audioChunk("BAUG"),
    ]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      "Google speech stream emitted a response after its terminal response.",
    );
    await expect(result.completion).rejects.toBe(error);
  });

  it("rejects a completed-only response instead of slicing its audio", async () => {
    const { client } = clientWithResponse(firstAudioChunk);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      "Google speech streaming requires an async iterable SDK response.",
    );
    await expect(result.completion).rejects.toBe(error);
  });
});
