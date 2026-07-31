import { expect, it } from "vitest";
import type { ExecutionAmendment } from "../src";

it("narrows amendment facets by operation family", () => {
  const embedding = {
    model: "embedding-model",
    use: { add: [] },
  } satisfies ExecutionAmendment<string, "embedding">;

  expect(embedding.model).toBe("embedding-model");

  // @ts-expect-error Language Tool selection is inert for embedding operations.
  const invalidTools: ExecutionAmendment<string, "embedding"> = {
    activeTools: ["lookup"],
  };
  // @ts-expect-error Whole-request language budgets do not apply to image operations.
  const invalidBudget: ExecutionAmendment<string, "image"> = {
    inputBudget: { max: 1_000 },
  };
  expect([invalidTools, invalidBudget]).toHaveLength(2);
});
