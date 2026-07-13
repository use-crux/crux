/**
 * `scriptedGateway()` — an in-memory `SdkGateway` for `@use-crux/ai` tests.
 *
 * Replaces `vi.mock('ai')`: tests script SDK results per method and assert
 * on the recorded call args. Streams replay scripted chunks through the
 * real `onChunk`/`onFinish` callback protocol so metrics code runs for real.
 */

import type { SdkGateway } from "../src/gateway";

/** A scripted `generateText`/`generateObject` result (partial, with defaults). */
export interface ScriptedResult {
  text?: string;
  object?: unknown;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown }>;
  content?: Array<Record<string, unknown>>;
  steps?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerMetadata?: unknown;
  finishReason?: string;
  responseMessages?: Array<Record<string, unknown>>;
}

/** A scripted stream: chunks plus the finish event fields. */
export interface ScriptedStream {
  chunks: string[];
  firstChunkDelayMs?: number;
  errorAfterChunks?: Error;
  finish?: ScriptedResult;
}

export interface ScriptedGatewayConfig {
  transcribe?: Array<Record<string, unknown> | Error>;
  generateImage?: Array<Record<string, unknown> | Error>;
  generateSpeech?: Array<Record<string, unknown> | Error>;
  generateText?: Array<ScriptedResult | Error>;
  generateObject?: Array<ScriptedResult | Error>;
  streamText?: ScriptedStream[];
  streamObject?: ScriptedStream[];
  embedMany?: Array<{ embeddings: number[][]; tokens: number }>;
  rerank?: Array<{ ranking: Array<{ originalIndex: number; score: number }> }>;
}

export interface ScriptedGateway {
  gateway: SdkGateway;
  calls: {
    generateImage: Array<Record<string, unknown>>;
    generateSpeech: Array<Record<string, unknown>>;
    transcribe: Array<Record<string, unknown>>;
    generateText: Array<Record<string, unknown>>;
    generateObject: Array<Record<string, unknown>>;
    streamText: Array<Record<string, unknown>>;
    streamObject: Array<Record<string, unknown>>;
    embedMany: Array<Record<string, unknown>>;
    rerank: Array<Record<string, unknown>>;
  };
}

function materialize(
  scripted: ScriptedResult,
  kind: "text" | "object",
): Record<string, unknown> {
  const text =
    scripted.text ??
    (scripted.object !== undefined ? JSON.stringify(scripted.object) : "");
  const usage = {
    inputTokens: scripted.usage?.inputTokens ?? 10,
    outputTokens: scripted.usage?.outputTokens ?? 20,
    totalTokens: scripted.usage?.totalTokens ?? 30,
  };
  const responseMessages =
    scripted.responseMessages ??
    (kind === "text"
      ? [{ role: "assistant", content: [{ type: "text", text }] }]
      : []);
  return {
    text,
    ...(scripted.object !== undefined ? { object: scripted.object } : {}),
    content: scripted.content ?? [],
    steps: Array.from({ length: scripted.steps ?? 1 }, () => ({})),
    toolCalls: scripted.toolCalls ?? [],
    usage,
    totalUsage: usage,
    finishReason: scripted.finishReason ?? "stop",
    providerMetadata: scripted.providerMetadata,
    response: {
      id: "scripted-resp",
      modelId: "scripted-model",
      messages: responseMessages,
    },
  };
}

/** Build a scripted gateway. Methods throw scripted `Error`s verbatim. */
export function scriptedGateway(
  config: ScriptedGatewayConfig = {},
): ScriptedGateway {
  const generateTextScripts = [...(config.generateText ?? [])];
  const generateImageScripts = [...(config.generateImage ?? [])];
  const generateSpeechScripts = [...(config.generateSpeech ?? [])];
  const transcribeScripts = [...(config.transcribe ?? [])];
  const generateObjectScripts = [...(config.generateObject ?? [])];
  const streamTextScripts = [...(config.streamText ?? [])];
  const streamObjectScripts = [...(config.streamObject ?? [])];
  const embedScripts = [...(config.embedMany ?? [])];
  const rerankScripts = [...(config.rerank ?? [])];

  const calls: ScriptedGateway["calls"] = {
    generateImage: [],
    generateSpeech: [],
    transcribe: [],
    generateText: [],
    generateObject: [],
    streamText: [],
    streamObject: [],
    embedMany: [],
    rerank: [],
  };

  function runStream(
    args: Record<string, unknown>,
    scripted: ScriptedStream | undefined,
    kind: "text" | "object",
  ): Record<string, unknown> {
    const script = scripted ?? { chunks: ["scripted ", "stream"] };
    const onChunk = args.onChunk as
      | ((event: unknown) => Promise<void>)
      | undefined;
    const onFinish = args.onFinish as
      | ((event: unknown) => Promise<void>)
      | undefined;
    // Replay asynchronously, like a real stream.
    void (async () => {
      if (script.firstChunkDelayMs !== undefined) {
        await delay(script.firstChunkDelayMs);
      }
      for (const chunk of script.chunks) {
        await onChunk?.({ chunk: { type: "text-delta", textDelta: chunk } });
      }
      if (script.errorAfterChunks) return;
      const finish = materialize(
        { text: script.chunks.join(""), ...script.finish },
        kind,
      );
      await onFinish?.(finish);
    })();
    async function* textStream() {
      if (script.firstChunkDelayMs !== undefined) {
        await delay(script.firstChunkDelayMs);
      }
      for (const chunk of script.chunks) yield chunk;
      if (script.errorAfterChunks) throw script.errorAfterChunks;
    }
    return {
      kind: `scripted-${kind}-stream`,
      textStream: textStream(),
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    };
  }

  const gateway: SdkGateway = {
    transcribe: async (args) => {
      calls.transcribe.push(args as Record<string, unknown>);
      const scripted = transcribeScripts.shift();
      if (scripted instanceof Error) throw scripted;
      return (scripted ?? {
        text: "scripted transcript",
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        responses: [],
        providerMetadata: {},
      }) as unknown as Awaited<ReturnType<SdkGateway["transcribe"]>>;
    },
    generateImage: async (args) => {
      calls.generateImage.push(args as Record<string, unknown>);
      const scripted = generateImageScripts.shift();
      if (scripted instanceof Error) throw scripted;
      return (scripted ?? {
        image: {
          base64: "AQ==",
          uint8Array: new Uint8Array([1]),
          mediaType: "image/png",
        },
        images: [
          {
            base64: "AQ==",
            uint8Array: new Uint8Array([1]),
            mediaType: "image/png",
          },
        ],
        warnings: [],
        responses: [],
        providerMetadata: {},
        usage: {},
      }) as unknown as Awaited<ReturnType<SdkGateway["generateImage"]>>;
    },
    generateSpeech: async (args) => {
      calls.generateSpeech.push(args as Record<string, unknown>);
      const scripted = generateSpeechScripts.shift();
      if (scripted instanceof Error) throw scripted;
      return (scripted ?? {
        audio: {
          base64: "AQ==",
          uint8Array: new Uint8Array([1]),
          mediaType: "audio/mpeg",
          format: "mp3",
        },
        warnings: [],
        responses: [],
        providerMetadata: {},
      }) as unknown as Awaited<ReturnType<SdkGateway["generateSpeech"]>>;
    },
    generateText: async (args) => {
      calls.generateText.push(args as Record<string, unknown>);
      const scripted = generateTextScripts.shift() ?? {
        text: "scripted response",
      };
      if (scripted instanceof Error) throw scripted;
      return materialize(scripted, "text") as unknown as Awaited<
        ReturnType<SdkGateway["generateText"]>
      >;
    },
    generateObject: async (args) => {
      calls.generateObject.push(args as Record<string, unknown>);
      const scripted = generateObjectScripts.shift() ?? { object: {} };
      if (scripted instanceof Error) throw scripted;
      return materialize(scripted, "object") as unknown as Awaited<
        ReturnType<SdkGateway["generateObject"]>
      >;
    },
    streamText: (args) => {
      calls.streamText.push(args as Record<string, unknown>);
      return runStream(
        args as Record<string, unknown>,
        streamTextScripts.shift(),
        "text",
      ) as unknown as ReturnType<SdkGateway["streamText"]>;
    },
    streamObject: (args) => {
      calls.streamObject.push(args as Record<string, unknown>);
      return runStream(
        args as Record<string, unknown>,
        streamObjectScripts.shift(),
        "object",
      ) as unknown as ReturnType<SdkGateway["streamObject"]>;
    },
    embedMany: async (args) => {
      calls.embedMany.push(args as Record<string, unknown>);
      const scripted = embedScripts.shift() ?? {
        embeddings: [[0.1, 0.2]],
        tokens: 4,
      };
      return {
        embeddings: scripted.embeddings,
        usage: { tokens: scripted.tokens },
      } as unknown as Awaited<ReturnType<SdkGateway["embedMany"]>>;
    },
    rerank: async (args) => {
      calls.rerank.push(args as Record<string, unknown>);
      const scripted = rerankScripts.shift() ?? { ranking: [] };
      return { ranking: scripted.ranking } as unknown as Awaited<
        ReturnType<SdkGateway["rerank"]>
      >;
    },
  };

  return { gateway, calls };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build an AI-SDK-shaped structured-output failure (what `generateObject` throws). */
export function objectGenerationError(rawText: string): Error {
  return Object.assign(
    new Error("response did not match the expected schema"),
    {
      name: "NoObjectGeneratedError",
      text: rawText,
    },
  );
}
