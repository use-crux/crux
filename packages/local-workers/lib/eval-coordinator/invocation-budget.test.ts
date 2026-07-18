import { describe, expect, it } from "vitest";
import { createEvalInvocationBudget } from "./invocation-budget";

describe("Eval CLI invocation budget", () => {
  it("decrements one cap across every selected Eval plan", () => {
    const budget = createEvalInvocationBudget(0.1);

    expect(budget.limit()).toBe(0.1);
    budget.consume({ knownMaximumUsd: 0.06 });
    expect(budget.limit()).toBeCloseTo(0.04);
    budget.consume({ knownMaximumUsd: 0.04 });
    expect(budget.limit()).toBe(0);
  });
});
