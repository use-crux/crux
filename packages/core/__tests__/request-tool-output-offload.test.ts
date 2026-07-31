import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  config,
  offload,
  offloadable,
  prompt,
  tool,
  type AdapterSpec,
  type CallArgs,
} from "../src";
import { inMemoryRecordStore } from "../src/storage";
import { historyResponse as response } from "./request-history-harness";

describe.sequential("Tool output offload", () => {
  it("keeps small outputs inline and offloads large outputs without changing canonical evidence", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ storage: { records } });
    const results: Array<{
      readonly output?: unknown;
      readonly modelOutput: unknown;
      readonly offloadReceipt?: unknown;
    }> = [];
    const canonical = {
      records: Array.from({ length: 120 }, (_, index) => ({
        index,
        value: `record-${index}`,
      })),
    };
    const fetchRecords = tool({
      description: "Fetch exact records.",
      input: z.object({ small: z.boolean() }),
      execute: ({ small }) => small ? "ok" : canonical,
      output: offloadable({ aboveTokens: 20 }),
    });
    let call = 0;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "tool-output-offload-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call() {
        call += 1;
        if (call <= 2) {
          return {
            raw: { text: "" },
            extracted: {
              ...response(""),
              toolCalls: [{
                id: `fetch-${call}`,
                name: "fetchRecords",
                args: { small: call === 1 },
              }],
              finishReason: "tool-calls" as const,
            },
          };
        }
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages, _assistant, settled) {
        results.push(...settled);
        return messages;
      },
      mapSettings: () => ({}),
    };

    try {
      await adapter(spec)({}).generate(
        prompt({
          id: "tool-output-offload",
          tools: { fetchRecords },
          prompt: "Fetch both result sizes.",
        }),
        { model: "tool-output-model" },
      );

      expect(results[0]).toMatchObject({
        output: "ok",
        modelOutput: { type: "text", value: "ok" },
      });
      expect(results[1]).toMatchObject({
        output: canonical,
        modelOutput: {
          type: "json",
          value: {
            type: "exact-recovery-reference",
            handle: expect.stringMatching(/^offload_[a-f0-9]+$/),
            preview: expect.stringContaining("[Exact JSON reference]"),
          },
        },
        offloadReceipt: {
          handle: expect.stringMatching(/^offload_[a-f0-9]+$/),
          revision: 1,
          bytes: expect.any(Number),
        },
      });
      expect(
        (await records.list("crux:request-offload:v1:")).entries,
      ).toHaveLength(1);
    } finally {
      installation.dispose();
    }
  });

  it("forces offload while retaining the canonical result in evidence", async () => {
    const installation = config({
      storage: { records: inMemoryRecordStore() },
    });
    const canonical = { exact: "forced Tool result" };
    const results: Array<{
      readonly output?: unknown;
      readonly modelOutput: unknown;
      readonly offloadReceipt?: unknown;
    }> = [];
    const requests: CallArgs[] = [];
    const forcedResult = tool({
      description: "Return one forced exact result.",
      input: z.object({}),
      execute: () => offload(canonical),
    });
    let call = 0;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "forced-tool-output-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        requests.push(args);
        call += 1;
        return call === 1
          ? {
              raw: { text: "" },
              extracted: {
                ...response(""),
                toolCalls: [{
                  id: "forced-result",
                  name: "forcedResult",
                  args: {},
                }],
                finishReason: "tool-calls" as const,
              },
            }
          : { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages, _assistant, settled) {
        results.push(...settled);
        return messages;
      },
      mapSettings: () => ({}),
    };

    try {
      await adapter(spec)({}).generate(
        prompt({
          id: "forced-tool-output",
          tools: { forcedResult },
          prompt: "Return the exact result.",
        }),
        { model: "forced-tool-output-model" },
      );

      expect(results).toEqual([
        expect.objectContaining({
          output: canonical,
          modelOutput: {
            type: "json",
            value: expect.objectContaining({
              type: "exact-recovery-reference",
            }),
          },
          offloadReceipt: expect.objectContaining({ revision: 1 }),
        }),
      ]);
      expect(requests[0]?.tools?.map((entry) => entry.name)).toEqual([
        "forcedResult",
      ]);
      expect(requests[1]?.tools?.map((entry) => entry.name)).toEqual([
        "forcedResult",
        "__crux_ReadOffload",
      ]);
    } finally {
      installation.dispose();
    }
  });
});
