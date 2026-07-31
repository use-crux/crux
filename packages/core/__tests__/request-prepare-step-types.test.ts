import { expect, it } from "vitest";
import { z } from "zod";
import {
  history,
  workingState,
  type PrepareStep,
} from "../src";

it("narrows preparation authority at compile time", () => {
  const managedHistory = history();
  const state = workingState({
    id: "type-state",
    schema: z.object({ value: z.string() }),
  });

  const rawReplacement: PrepareStep<string> = () => ({
    // @ts-expect-error canonical messages are not amendable
    messages: [],
  });
  const systemReplacement: PrepareStep<string> = () => ({
    // @ts-expect-error raw system replacement is not amendable
    system: "replacement",
  });
  const historyOwnership: PrepareStep<string> = () => ({
    use: {
      add: [
        // @ts-expect-error history ownership is not amendable
        managedHistory,
      ],
    },
  });
  const unattachedState: PrepareStep<string> = () => ({
    use: {
      add: [
        // @ts-expect-error workingState must remain owned by Memory
        state,
      ],
    },
  });

  expect([
    rawReplacement,
    systemReplacement,
    historyOwnership,
    unattachedState,
  ]).toHaveLength(4);
});
