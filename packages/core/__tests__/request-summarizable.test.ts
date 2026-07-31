import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  config,
  context,
  prompt,
  summarizable,
  tool,
  type AdapterSpec,
  type CallArgs,
} from "../src";
import { inMemoryRecordStore } from "../src/storage";
import { historyResponse as response } from "./request-history-harness";

describe.sequential("summarizable()", () => {
  it("prepares and selects one derived summary while retaining source capabilities", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ persistence: { records } });
    const requests: CallArgs[] = [];
    const lookup = tool({
      description: "Look up an exact document section.",
      input: z.object({ section: z.string() }),
      execute: ({ section }) => section,
    });
    const docs = context({
      id: "summarizable-docs",
      system: "Canonical product documentation. ".repeat(160),
      tools: { lookup },
    });
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "summarizable-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        requests.push(args);
        const text = args.system?.includes("source summarizer")
          ? "Concise derived product documentation."
          : "done";
        return { raw: { text }, extracted: response(text) };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };
    const summarizedPrompt = prompt({
      id: "summarizable-source",
      use: [summarizable(docs)],
      prompt: "Answer from the docs.",
    });

    try {
      const result = await adapter(spec)({}).generate(
        summarizedPrompt,
        {
          model: "summary-model",
          inputBudget: { optimizeAt: 80, max: 120 },
        },
      );

      expect(requests).toHaveLength(2);
      expect(requests[1]?.system).toContain(
        "Concise derived product documentation.",
      );
      expect(requests[1]?.system).not.toContain(
        "Canonical product documentation.",
      );
      expect(requests[1]?.tools?.map((entry) => entry.name)).toEqual([
        "lookup",
      ]);
      expect(result.steps[0]?.request?.adaptations).toEqual([
        expect.objectContaining({
          contributor: "summarizable-docs",
          representation: "summary",
          supportRequestId: expect.stringMatching(/^request_/),
        }),
      ]);
      expect(
        (await records.list("crux:request-summary:v1:source:")).entries,
      ).toHaveLength(1);

      await adapter(spec)({}).generate(summarizedPrompt, {
        model: "summary-model",
        inputBudget: { optimizeAt: 80, max: 120 },
      });
      expect(requests).toHaveLength(3);
      expect(requests[2]?.system).toContain(
        "Concise derived product documentation.",
      );
    } finally {
      installation.dispose();
    }
  });

  it("treats source arrays atomically, unions capabilities, and rejects member collisions", async () => {
    const installation = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const firstTool = tool({
      description: "Read the first source.",
      input: z.object({}),
      execute: () => "first",
    });
    const secondTool = tool({
      description: "Read the second source.",
      input: z.object({}),
      execute: () => "second",
    });
    const first = context({
      id: "summary-array-first",
      system: "First canonical source. ".repeat(100),
      tools: { firstTool },
    });
    const second = context({
      id: "summary-array-second",
      system: "Second canonical source. ".repeat(100),
      tools: { secondTool },
    });
    const requests: CallArgs[] = [];
    const call = async (_client: object, args: CallArgs) => {
      requests.push(args);
      const text = args.system?.includes("source summarizer")
        ? "One atomic derived summary."
        : "done";
      return { raw: { text }, extracted: response(text) };
    };
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "summary-array-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      call,
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
          id: "summary-array",
          use: [summarizable([first, second])],
          prompt: "Answer.",
        }),
        {
          model: "summary-array-model",
          inputBudget: { optimizeAt: 80, max: 120 },
        },
      );

      expect(requests).toHaveLength(2);
      expect(requests[1]?.system).toContain("One atomic derived summary.");
      expect(requests[1]?.tools?.map((entry) => entry.name)).toEqual([
        "firstTool",
        "secondTool",
      ]);

      const shared = tool({
        description: "Conflicting member capability.",
        input: z.object({}),
        execute: () => "shared",
      });
      const collision = prompt({
        id: "summary-array-collision",
        use: [
          summarizable([
            context({
              id: "collision-first",
              system: "First.",
              tools: { shared },
            }),
            context({
              id: "collision-second",
              system: "Second.",
              tools: { shared },
            }),
          ]),
        ],
        prompt: "Answer.",
      });
      await expect(
        runtime.generate(collision, { model: "summary-array-model" }),
      ).rejects.toThrow('Tool name collision for "shared"');
      expect(requests).toHaveLength(2);
    } finally {
      installation.dispose();
    }
  });
});
