import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  config,
  context,
  offload,
  offloadable,
  prompt,
  RequestCompositionError,
  type AdapterSpec,
  type CallArgs,
} from "../src";
import { inMemoryRecordStore } from "../src/storage";
import { permissiveCapabilities } from "./adapter/structured-output/capability-fixtures";
import { historyResponse as response } from "./request-history-harness";

describe.sequential("offloadable()", () => {
  it("publishes before dispatch and exposes only a bounded opaque retrieval reference", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ persistence: { records } });
    const canonical = "Exact private deployment log line. ".repeat(180);
    const observed: Array<{
      readonly request: CallArgs;
      readonly published: number;
    }> = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "offload-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        observed.push({
          request: args,
          published: (
            await records.list("crux:request-offload:v1:")
          ).entries.length,
        });
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };

    try {
      const result = await adapter(spec)({}).generate(
        prompt({
          id: "offload-source",
          use: [
            offloadable(
              context({
                id: "deployment-logs",
                system: canonical,
              }),
            ),
          ],
          prompt: "Diagnose the deployment.",
        }),
        {
          model: "offload-model",
          inputBudget: { optimizeAt: 80, max: 180 },
        },
      );

      expect(observed).toHaveLength(1);
      expect(observed[0]?.published).toBe(1);
      expect(observed[0]?.request.tools?.map((entry) => entry.name)).toEqual([
        "__crux_ReadOffload",
      ]);
      const visible = observed[0]?.request.system?.replace(
        /offload_[a-f0-9]+/,
        "offload_opaque",
      );
      expect(visible).toMatchInlineSnapshot(`
        "[Exact text reference]
        Preview: Exact private deployment log line. Exact private deployment log line. Exact private deployment log line. Exact private deployment log line. Exact private deployment log line. Exact private deployment …
        Handle: offload_opaque"
      `);
      expect(visible).not.toContain(canonical);
      expect(JSON.stringify(observed[0]?.request)).not.toContain(
        "crux:request-offload",
      );
      expect(JSON.stringify(observed[0]?.request)).not.toContain(canonical);
      expect(result.steps[0]?.request?.adaptations).toEqual([
        expect.objectContaining({
          contributor: "deployment-logs",
          representation: "offload",
        }),
      ]);
    } finally {
      installation.dispose();
    }
  });

  it("forces exact recovery with backing and rejects Tool-less structured output", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ persistence: { records } });
    const requests: CallArgs[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "forced-offload-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      structuredOutput: { accepts: permissiveCapabilities },
      async call(_client, args) {
        requests.push(args);
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };
    const runtime = adapter(spec)({});

    try {
      await runtime.generate(
        prompt({
          id: "forced-offload",
          use: [offload({ kind: "audit", entries: [1, 2, 3] })],
          prompt: "Inspect the exact audit data.",
        }),
        { model: "forced-model" },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]?.system).toContain("[Exact JSON reference]");
      expect(requests[0]?.tools?.map((entry) => entry.name)).toEqual([
        "__crux_ReadOffload",
      ]);

      const structured = prompt({
        id: "structured-offload",
        use: [
          offloadable(
            context({
              id: "structured-offload-source",
              system: "Large exact source. ".repeat(120),
            }),
          ),
        ],
        prompt: "Return structured output.",
        output: z.object({ answer: z.string() }),
      });
      const error = await runtime
        .generate(structured, {
          model: "forced-model",
          inputBudget: { max: 60 },
        })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(RequestCompositionError);
      expect(error).toMatchObject({ code: "REPRESENTATION_UNAVAILABLE" });
      expect(requests).toHaveLength(1);
    } finally {
      installation.dispose();
    }
  });

  it("retrieves the exact canonical value through the injected bounded Tool", async () => {
    const installation = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const canonical = {
      kind: "trace",
      entries: Array.from({ length: 80 }, (_, index) => ({
        index,
        status: "ok",
      })),
    };
    const toolResults: unknown[] = [];
    let calls = 0;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "offload-retrieval-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        calls += 1;
        if (calls === 1) {
          const handle = args.system?.match(/offload_[a-f0-9]+/)?.[0];
          return {
            raw: { text: "" },
            extracted: {
              ...response(""),
              toolCalls: [{
                id: "read-offload-1",
                name: "__crux_ReadOffload",
                args: { handle },
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
      appendToolRound(messages, _assistant, results) {
        toolResults.push(...results);
        return messages;
      },
      mapSettings: () => ({}),
    };

    try {
      await adapter(spec)({}).generate(
        prompt({
          id: "offload-retrieval",
          use: [offload(canonical)],
          prompt: "Read the trace.",
        }),
        { model: "retrieval-model" },
      );

      expect(calls).toBe(2);
      expect(toolResults).toEqual([
        expect.objectContaining({
          name: "__crux_ReadOffload",
          output: canonical,
          modelOutput: { type: "json", value: canonical },
        }),
      ]);
    } finally {
      installation.dispose();
    }
  });
});
