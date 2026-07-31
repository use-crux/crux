import { describe, expect, it } from "vitest";
import {
  adapter,
  history,
  prompt,
  summarize,
  type AdapterSpec,
  type Message,
} from "../src";
import { historyResponse } from "./request-history-harness";

const messages: Message[] = Array.from({ length: 10 }, (_, index) => [
  {
    role: "user" as const,
    content: `question ${index} with detailed historical account context`,
  },
  {
    role: "assistant" as const,
    content: `answer ${index} with detailed historical account preferences`,
  },
]).flat();

describe("managed history summary strategies", () => {
  it.each([
    ["regenerate", summarize.regenerate(), 1],
    ["rolling", summarize.rolling(), 2],
    ["hierarchical", summarize.hierarchical(), 3],
    ["adaptive", summarize.adaptive(), 3],
  ] as const)(
    "executes %s through deterministic bounded support calls",
    async (name, strategy, expectedCalls) => {
      let supportCalls = 0;
      const spec: AdapterSpec<object, { readonly text: string }> = {
        providerId: `strategy-${name}`,
        capacity: () => ({
          contextWindow: 32_768,
          defaultOutputReserve: 256,
          countingConfidence: "estimated",
        }),
        async call(_client, args) {
          if (args.system?.includes("conversation summarizer")) {
            supportCalls += 1;
            return {
              raw: { text: `summary ${supportCalls}` },
              extracted: historyResponse(`summary ${supportCalls}`),
            };
          }
          return {
            raw: { text: "done" },
            extracted: historyResponse("done"),
          };
        },
        async stream() {
          throw new Error("not used");
        },
        appendToolRound: (value) => value,
        mapSettings: () => ({}),
      };
      const managed = prompt({
        id: `strategy-${name}`,
        use: [
          history({
            recent: 2,
            summary: { strategy },
            providerNative: false,
          }),
        ],
        prompt: "unused in manual transcript mode",
      });

      const result = await adapter(spec)({}).generate(managed, {
        model: "strategy-model",
        messages,
        inputBudget: { max: 120, optimizeAt: 100 },
      });

      expect(supportCalls).toBe(expectedCalls);
      expect(
        result.steps[0]?.request?.adaptations[0]?.supportRequestIds,
      ).toHaveLength(expectedCalls);
      await expect(
        result.steps[0]?.request?.inspect(),
      ).resolves.toMatchObject({
        supportRequests: { length: expectedCalls },
      });
    },
  );
});
