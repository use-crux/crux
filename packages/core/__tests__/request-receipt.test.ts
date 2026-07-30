import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  tool,
  type AdapterSpec,
  type StreamHandle,
} from "../src";
import { permissiveCapabilities } from "./adapter/structured-output/capability-fixtures";

const receiptPrompt = prompt({
  id: "request-receipt",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

const sealedReceiptPrompt = prompt({
  id: "sealed-request-receipt",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
  output: z.object({ message: z.string() }),
  tools: {
    noop: tool({
      description: "Return the input.",
      input: z.object({ value: z.string() }),
      execute: ({ value }) => value,
    }),
  },
});

async function* emptyStream(): AsyncIterable<string> {}

describe("request receipts", () => {
  it("reuses one sealed request across adapter transport retries", async () => {
    class ProviderOption {
      readonly #value = "valid";

      read(): string {
        return this.#value;
      }
    }
    const opaqueOption = new ProviderOption();
    const countTokens = vi.fn(async () => 5);
    const transport = vi.fn(async (request: unknown) => request);
    const spec: AdapterSpec<object, object> = {
      providerId: "receipt-test",
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      structuredOutput: { accepts: permissiveCapabilities },
      countTokens,
      call: async (_client, request) => {
        await transport(request);
        await transport(request);
        await transport(request);
        return {
          raw: {},
          extracted: {
            text: '{"message":"done"}',
            toolCalls: undefined,
            usage: undefined,
            finishReason: "stop",
            responseId: undefined,
            actualModelId: "retry-model",
            transportRetries: 2,
          },
        };
      },
      stream: async () => {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(sealedReceiptPrompt, {
      model: "retry-model",
      input: { message: "x".repeat(100) },
      inputBudget: { max: 10 },
      extra: { opaqueOption },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: new Uint8Array([1, 2, 3]),
              mediaType: "image/png",
            },
          ],
        },
      ],
    });

    expect(countTokens).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(
      transport.mock.calls.every(
        ([request]) => request === transport.mock.calls[0]?.[0],
      ),
    ).toBe(true);
    const sealed = transport.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.messages)).toBe(true);
    expect(Object.isFrozen(sealed.settings)).toBe(true);
    expect(Object.isFrozen(sealed.outputSchema)).toBe(true);
    expect(Object.isFrozen(sealed.tools)).toBe(true);
    expect(Object.isFrozen(sealed.extra)).toBe(true);
    const sealedExtra = sealed.extra as {
      opaqueOption: ProviderOption;
    };
    expect(sealedExtra.opaqueOption).toBe(opaqueOption);
    expect(sealedExtra.opaqueOption.read()).toBe("valid");
    const image = (
      sealed.messages as Array<{
        content:
          | string
          | Array<{
              type: string;
              source?: { data?: Uint8Array };
            }>;
      }>
    )
      .flatMap((message) =>
        Array.isArray(message.content) ? message.content : [],
      )
      .find((part) => part.type === "image");
    const source = image?.source;
    const firstRead = source?.data;
    expect(firstRead).toBeInstanceOf(Uint8Array);
    expect(source?.data).not.toBe(firstRead);
    if (firstRead) firstRead[0] = 99;
    expect(source?.data?.[0]).toBe(1);
    await expect(result.steps[0]?.request?.inspect()).resolves.toMatchObject({
      retryCount: 2,
    });
  });

  it("attaches a sealed request receipt to Core-owned stream completion", async () => {
    const spec: AdapterSpec<object, object, AsyncIterable<string>> = {
      providerId: "receipt-test",
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      call: async () => {
        throw new Error("not used");
      },
      stream: async (): Promise<StreamHandle<AsyncIterable<string>>> => ({
        rawStream: emptyStream(),
        extractTextDelta: (chunk) =>
          typeof chunk === "string" ? chunk : undefined,
        completion: async () => ({
          text: "done",
          finishReason: "stop",
          actualModelId: "stream-model",
        }),
      }),
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).stream(receiptPrompt, {
      model: "stream-model",
      input: { message: "hello" },
    });
    const completion = await result.completion;
    const receipt = completion.steps[0]?.request;

    expect(receipt).toMatchObject({
      model: "stream-model",
      measurement: "estimated",
      adaptations: [],
    });
    expect(Object.keys(receipt ?? {})).not.toContain("inspect");
    expect(JSON.parse(JSON.stringify(receipt))).toMatchObject({
      model: "stream-model",
      adaptations: [],
      warnings: [],
    });
    await expect(receipt?.inspect()).resolves.toMatchObject({
      measurement: "estimated",
      retryCount: 0,
      retention: "requires observability retention",
      breakdown: {
        contributions: expect.arrayContaining([
          expect.objectContaining({ contributor: "messages" }),
        ]),
      },
    });
  });
});
