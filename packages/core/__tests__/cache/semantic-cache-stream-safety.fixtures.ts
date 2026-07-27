import type { AnyPrompt } from "../../src/prompt/prompt-types";
import type {
  Constraint,
  Guardrail,
  SafetyTuneOptions,
} from "../../src/safety";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type {
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
} from "../../src/adapter/executor-types";
import type { AdapterSpec } from "../../src/adapter/spec";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type {
  AdapterResponse,
  StreamCompletionMetadata,
  StreamHandle,
} from "../../src/adapter/types";
import { createSemanticCache } from "../../src/cache";
import { resetHooks } from "../../src/runtime/runtime";
import { inMemoryStorage } from "../../src/storage";
import { permissiveCapabilities } from "../adapter/structured-output/capability-fixtures";
import {
  denseEmbedding,
  installSemanticCachePlugins,
} from "./semantic-cache.fixtures";

export type StreamRegime = "core" | "sdk";

export interface CachedStreamOptions {
  readonly guardrails?: readonly Guardrail[];
  readonly constraints?: readonly Constraint[];
  readonly constraintMaxRetries?: number;
  readonly safety?: SafetyTuneOptions;
}

export interface CachedStreamPair {
  readonly text: string;
  readonly object?: unknown;
  readonly meta: Record<string, unknown>;
  readonly providerGenerateCalls: number;
  readonly providerStreamCalls: number;
  readonly replayCalls: number;
  readonly publicHandle: object;
}

/**
 * Fill semantic cache through generate, then request the same candidate through
 * stream using either adapter ownership regime.
 */
export async function streamCachedPair(options: {
  readonly regime: StreamRegime;
  readonly kind: "text" | "object";
  readonly prompt: AnyPrompt;
  readonly cachedOutput: string;
  readonly liveChunks?: readonly string[];
  readonly sdkReplay?: boolean;
  readonly call?: CachedStreamOptions;
  readonly between?: () => void | Promise<void>;
}): Promise<CachedStreamPair> {
  resetHooks();
  installSemanticCachePlugins(
    createSemanticCache({
      storage: inMemoryStorage(),
      embedding: denseEmbedding(),
      ttl: 60_000,
      scope: "global",
    }),
  );

  return options.regime === "core"
    ? streamCorePair(options)
    : streamSdkPair(options);
}

async function streamCorePair(
  options: Parameters<typeof streamCachedPair>[0],
): Promise<CachedStreamPair> {
  const script = coreScript(options.cachedOutput, options.liveChunks);
  const runtime = adapter(script.spec)(script.client);
  const call = {
    model: "test-model",
    input: { message: "billing help" },
    ...options.call,
  };
  await runtime.generate(options.prompt as never, call as never);
  await options.between?.();
  const result = await runtime.stream(options.prompt as never, call as never);
  let text = "";
  for await (const chunk of result.textStream) text += chunk;
  const completion = await result.completion;
  return {
    text,
    object: completion.object,
    meta: completion as unknown as Record<string, unknown>,
    providerGenerateCalls: script.generateCalls,
    providerStreamCalls: script.streamCalls,
    replayCalls: script.replayCalls,
    publicHandle: result,
  };
}

async function streamSdkPair(
  options: Parameters<typeof streamCachedPair>[0],
): Promise<CachedStreamPair> {
  const fake =
    options.kind === "object"
      ? fakeLoopRuntime({
          structured: [options.cachedOutput],
          streams: [options.liveChunks ?? ['{"value":"fresh"}']],
        })
      : fakeLoopRuntime({
          loops: [[{ text: options.cachedOutput }]],
          streams: [options.liveChunks ?? ["fresh text"]],
        });
  let replayCalls = 0;
  const runtime = loopRuntimeAdapter(
    options.sdkReplay === false
      ? fake.runtime
      : {
          ...fake.runtime,
          replayStream(cached) {
            replayCalls++;
            return replaySdkStream(cached);
          },
        },
  );
  const call = {
    model: "fake:test-model",
    input: { message: "billing help" },
    ...options.call,
  };
  await runtime.generate(options.prompt as never, call as never);
  await options.between?.();
  const result = await runtime.stream(options.prompt as never, call as never);
  const raw = result.raw as {
    readonly text: string;
    readonly object?: unknown;
  };
  const completion = await result.completion();
  return {
    text: raw.text,
    object: completion?.object,
    meta: (completion ?? {}) as Record<string, unknown>,
    providerGenerateCalls:
      options.kind === "object"
        ? fake.calls.runStructuredAttempt.length
        : fake.calls.runTextLoop.length,
    providerStreamCalls: fake.calls.runStream.length,
    replayCalls,
    publicHandle: result,
  };
}

function coreScript(cachedOutput: string, liveChunks?: readonly string[]) {
  const client = { kind: "semantic-cache-stream" as const };
  let generateCalls = 0;
  let streamCalls = 0;
  let replayCalls = 0;
  const spec: AdapterSpec<
    typeof client,
    { readonly call: number },
    AsyncIterable<string>
  > = {
    providerId: "semantic-cache-stream",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      generateCalls++;
      return {
        raw: { call: generateCalls },
        extracted: response(cachedOutput),
      };
    },
    async stream(_client, args): Promise<StreamHandle<AsyncIterable<string>>> {
      streamCalls++;
      const chunks = liveChunks ?? ["fresh text"];
      const text = chunks.join("");
      const structured = args.outputSchema !== undefined;
      return {
        rawStream: fromChunks(chunks),
        extractTextDelta: (chunk) =>
          typeof chunk === "string" ? chunk : undefined,
        completion: async () => ({
          text,
          ...(structured ? { object: JSON.parse(text) } : {}),
          finishReason: "stop",
        }),
      };
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
  return {
    spec,
    client,
    get generateCalls() {
      return generateCalls;
    },
    get streamCalls() {
      return streamCalls;
    },
    get replayCalls() {
      return replayCalls;
    },
  };
}

function replaySdkStream(cached: {
  readonly text?: string;
  readonly object?: unknown;
  readonly meta?: Record<string, unknown>;
}): ExecutorProviderStreamHandle<{
  readonly text: string;
  readonly object?: unknown;
}> {
  const text =
    cached.text ??
    (cached.object !== undefined ? JSON.stringify(cached.object) : "");
  const meta: ExecutorStreamCompletionPayload = {
    ...cached.meta,
    text,
    ...(cached.object !== undefined ? { object: cached.object } : {}),
    semanticCache: {
      ...(cached.meta?.semanticCache as Record<string, unknown> | undefined),
      replay: true,
    },
  };
  return {
    raw: {
      text,
      ...(cached.object !== undefined ? { object: cached.object } : {}),
    },
    completion: async () => meta,
  };
}

async function* fromChunks(chunks: readonly string[]) {
  yield* chunks;
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
