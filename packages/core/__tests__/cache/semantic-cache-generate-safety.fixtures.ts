import type { AnyPrompt } from "../../src/prompt/prompt-types";
import type {
  Constraint,
  Guardrail,
  SafetyTuneOptions,
} from "../../src/safety";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { AdapterSpec } from "../../src/adapter/spec";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { AdapterResponse } from "../../src/adapter/types";
import type { TokenUsage } from "../../src/generation/types";
import type { Storage } from "../../src/storage";
import { inMemoryStorage } from "../../src/storage";
import { createSemanticCache } from "../../src/cache";
import { permissiveCapabilities } from "../adapter/structured-output/capability-fixtures";
import {
  denseEmbedding,
  installSemanticCachePlugins,
} from "./semantic-cache.fixtures";

export type GenerateRegime = "core" | "sdk";

export interface CachedGenerateResult {
  readonly text: string;
  readonly object?: unknown;
  readonly _meta: Record<string, unknown>;
}

export interface CachedGenerateOptions {
  readonly guardrails?: readonly Guardrail[];
  readonly constraints?: readonly Constraint[];
  readonly constraintMaxRetries?: number;
  readonly maxSteps?: number;
  readonly safety?: SafetyTuneOptions;
}

export interface CachedPair {
  readonly first: CachedGenerateResult;
  readonly second: CachedGenerateResult;
  readonly providerCalls: number;
  readonly providerMessages: readonly (readonly unknown[] | undefined)[];
  readonly storage: Storage;
}

/**
 * Execute the same cache-enabled prompt twice through one adapter regime.
 *
 * The callback runs after the cache fill and before lookup, allowing tests to
 * change current policy without changing the cache key.
 */
export async function generateCachedPair(options: {
  readonly regime: GenerateRegime;
  readonly kind: "text" | "object";
  readonly prompt: AnyPrompt;
  readonly providerOutputs: readonly string[];
  readonly call?: CachedGenerateOptions;
  readonly between?: () => void | Promise<void>;
  readonly storage?: Storage;
  readonly onProviderCall?: () => void;
  /** Scripted Core-route billing facts, one per physical provider call. */
  readonly providerUsages?: readonly (TokenUsage | undefined)[];
}): Promise<CachedPair> {
  const storage = options.storage ?? inMemoryStorage();
  installSemanticCachePlugins(
    createSemanticCache({
      storage,
      embedding: denseEmbedding(),
      ttl: 60_000,
      scope: "global",
    }),
  );

  if (options.regime === "core") {
    const scripted = coreScript(
      options.providerOutputs,
      options.onProviderCall,
      options.providerUsages,
    );
    const runtime = adapter(scripted.spec)(scripted.client);
    const call = {
      model: "test-model",
      input: { message: "billing help" },
      ...options.call,
    };
    const first = (await runtime.generate(
      options.prompt as never,
      call as never,
    )) as CachedGenerateResult;
    await options.between?.();
    const second = (await runtime.generate(
      options.prompt as never,
      call as never,
    )) as CachedGenerateResult;
    return {
      first,
      second,
      providerCalls: scripted.calls,
      providerMessages: scripted.requests.map((request) => request.messages),
      storage,
    };
  }

  const fake =
    options.kind === "object"
      ? fakeLoopRuntime({ structured: options.providerOutputs })
      : fakeLoopRuntime({
          loops: options.providerOutputs.map((text) => [{ text }]),
        });
  const providerRuntime = {
    ...fake.runtime,
    runTextLoop: async (
      ...args: Parameters<typeof fake.runtime.runTextLoop>
    ) => {
      options.onProviderCall?.();
      return fake.runtime.runTextLoop(...args);
    },
    runStructuredAttempt: async (
      ...args: Parameters<typeof fake.runtime.runStructuredAttempt>
    ) => {
      options.onProviderCall?.();
      return fake.runtime.runStructuredAttempt(...args);
    },
  };
  const runtime = loopRuntimeAdapter(providerRuntime);
  const call = {
    model: "fake:test-model",
    input: { message: "billing help" },
    ...options.call,
  };
  const first = (await runtime.generate(
    options.prompt as never,
    call as never,
  )) as CachedGenerateResult;
  await options.between?.();
  const second = (await runtime.generate(
    options.prompt as never,
    call as never,
  )) as CachedGenerateResult;
  return {
    first,
    second,
    providerCalls:
      options.kind === "object"
        ? fake.calls.runStructuredAttempt.length
        : fake.calls.runTextLoop.length,
    providerMessages: (options.kind === "object"
      ? fake.calls.runStructuredAttempt
      : fake.calls.runTextLoop
    ).map((request) => request.messages),
    storage,
  };
}

function coreScript(
  outputs: readonly string[],
  onProviderCall: (() => void) | undefined,
  usages: readonly (TokenUsage | undefined)[] | undefined,
) {
  const queue = [...outputs];
  const usageQueue = [...(usages ?? [])];
  const client = { kind: "semantic-cache-release" as const };
  let calls = 0;
  const requests: import("../../src/adapter/types").CallArgs[] = [];
  const spec: AdapterSpec<typeof client, { readonly call: number }, never> = {
    providerId: "semantic-cache-release",
    structuredOutput: { accepts: permissiveCapabilities },
    async call(_client, args) {
      onProviderCall?.();
      requests.push(args);
      const text = queue.shift();
      if (text === undefined) throw new Error("provider script exhausted");
      calls++;
      return {
        raw: { call: calls },
        extracted: response(text, usageQueue.shift()),
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, assistant) {
      return [...messages, { role: "assistant", content: assistant.text }];
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
  return {
    spec,
    client,
    requests,
    get calls() {
      return calls;
    },
  };
}

function response(
  text: string,
  usage: TokenUsage | undefined,
): AdapterResponse {
  return {
    text,
    usage,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
