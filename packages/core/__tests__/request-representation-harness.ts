import { vi } from "vitest";
import {
  adapter,
  type AdapterSpec,
  type CallArgs,
} from "../src";

/** Build a deterministic Core-owned representation-planning harness. */
export function representationAdapter() {
  const requests: CallArgs<Record<string, unknown>>[] = [];
  const call = vi.fn(
    async (client: object, args: CallArgs<Record<string, unknown>>) => {
      void client;
      requests.push(args);
      return {
        raw: { text: "done" },
        extracted: {
          text: "done",
          usage: undefined,
          finishReason: "stop" as const,
          responseId: "response-1",
          actualModelId: "model-1",
        },
      };
    },
  );
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: "representation-test",
    capacity: () => ({
      contextWindow: 2_048,
      defaultOutputReserve: 128,
      countingConfidence: "estimated",
    }),
    call,
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return { runtime: adapter(spec)({}), requests, call };
}
