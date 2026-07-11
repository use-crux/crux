import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { prompt as makePrompt } from "@use-crux/core";
import { CruxAdapterError, isCruxAdapterError } from "@use-crux/core/adapter";
import { createOpenAI } from "../src";

const textPrompt = makePrompt({ id: "openai-normalized", prompt: "Hi" });

describe("OpenAI normalized finish reasons (generate)", () => {
  const cases: Array<[string, string]> = [
    ["stop", "stop"],
    ["length", "length"],
    ["tool_calls", "tool-calls"],
    ["content_filter", "content-filter"],
  ];
  for (const [raw, expected] of cases) {
    it(`maps finish_reason "${raw}" to "${expected}"`, async () => {
      const adapter = createOpenAI(completionClient({ finishReason: raw }));
      const result = await adapter.generate(textPrompt, { model: "gpt" });
      expect(result.finalStep.finishReason).toBe(expected);
    });
  }
});

describe("OpenAI stream completion metadata (previously dropped)", () => {
  it("requests usage and normalizes finishReason/usage/model on stream completion", async () => {
    const requests: unknown[] = [];
    const client = streamingClient(requests, {
      chunks: ["he", "llo"],
      finishReason: "stop",
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      model: "gpt-actual",
    });

    const handle = await createOpenAI(client).stream(textPrompt, { model: "gpt" });
    const streamed: string[] = [];
    for await (const chunk of handle.textStream) streamed.push(chunk);
    expect(streamed.join("")).toBe("hello");

    const completion = await handle.completion;
    expect(completion.finalStep.finishReason).toBe("stop");
    expect(completion.finalStep.usage?.totalTokens).toBe(7);
    expect(completion.finalStep.modelId).toBe("gpt-actual");

    // include_usage must be requested or the provider never sends the usage chunk.
    const body = requests[0] as { stream_options?: { include_usage?: boolean } };
    expect(body.stream_options?.include_usage).toBe(true);
  });

  it("does not swallow an erroring stream: the completion rejects with a normalized error", async () => {
    const client = {
      chat: {
        completions: {
          create: async () => erroringStream(),
        },
      },
    } as unknown as OpenAI;

    const handle = await createOpenAI(client).stream(textPrompt, { model: "gpt" });
    const drain = (async () => {
      for await (const _ of handle.textStream) void _;
    })();
    await expect(drain).rejects.toBeInstanceOf(CruxAdapterError);
    await expect(handle.completion).rejects.toBeInstanceOf(CruxAdapterError);
  });
});

describe("OpenAI normalized provider errors", () => {
  it("classifies a 429 as retryable rate-limit", async () => {
    const error = await capture(
      createOpenAI(throwingClient(429, "RateLimitError")).generate(textPrompt, {
        model: "gpt",
      }),
    );
    expect(isCruxAdapterError(error)).toBe(true);
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "rate-limit",
      retryable: true,
    });
  });

  it("classifies a 400 as non-retryable invalid-request", async () => {
    const error = await capture(
      createOpenAI(throwingClient(400, "BadRequestError")).generate(textPrompt, {
        model: "gpt",
      }),
    );
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "invalid-request",
      retryable: false,
    });
  });
});

describe("OpenAI abort/timeout normalization", () => {
  it("threads the caller AbortSignal into the SDK call", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const client = {
      chat: {
        completions: {
          create: async (_req: unknown, options?: { signal?: AbortSignal }) => {
            seen.push(options?.signal);
            return completion("stop");
          },
        },
      },
    } as unknown as OpenAI;
    const controller = new AbortController();
    await createOpenAI(client).generate(textPrompt, {
      model: "gpt",
      signal: controller.signal,
    });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("normalizes a step timeout to kind 'timeout'", async () => {
    const client = {
      chat: { completions: { create: () => new Promise<never>(() => {}) } },
    } as unknown as OpenAI;
    const error = await capture(
      createOpenAI(client).generate(textPrompt, {
        model: "gpt",
        timeout: { stepMs: 20 },
      }),
    );
    expect((error as CruxAdapterError).providerError.kind).toBe("timeout");
  });
});

function completionClient(opts: { finishReason: string }): OpenAI {
  return {
    chat: { completions: { create: async () => completion(opts.finishReason) } },
  } as unknown as OpenAI;
}

function throwingClient(status: number, name: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          const err = new Error(`openai ${status}`) as Error & { status: number };
          err.name = name;
          err.status = status;
          throw err;
        },
      },
    },
  } as unknown as OpenAI;
}

function streamingClient(
  requests: unknown[],
  script: {
    chunks: readonly string[];
    finishReason: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    model: string;
  },
): OpenAI {
  async function* stream() {
    for (const content of script.chunks) {
      yield {
        model: script.model,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      };
    }
    yield {
      model: script.model,
      choices: [{ index: 0, delta: {}, finish_reason: script.finishReason }],
      usage: script.usage,
    };
  }
  return {
    chat: {
      completions: {
        create: async (req: unknown) => {
          requests.push(req);
          return stream();
        },
      },
    },
  } as unknown as OpenAI;
}

function erroringStream(): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] };
      throw new Error("connection reset");
    },
  };
}

function completion(finishReason: string): unknown {
  return {
    id: "chatcmpl_1",
    model: "gpt-actual",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: "assistant", content: "hello" },
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error("expected the call to reject");
  } catch (error) {
    return error;
  }
}
