import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { EvalCard } from "./EvalCard";
import { EvalTimeoutCard } from "./EvalTimeoutCard";

function evalCase(
  attributes: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
): ObservabilityRunDetailNode {
  return {
    primitive: "eval.case",
    status: "cancelled",
    attributes,
    ...overrides,
  } as unknown as ObservabilityRunDetailNode;
}

describe("EvalTimeoutCard", () => {
  it("is selected by the normal Runs Eval card", () => {
    const html = renderToStaticMarkup(
      <EvalCard
        node={evalCase({
          evalOutcome: "timed_out",
          timeoutBudget: "step",
          timeoutLimitMs: 5_000,
        })}
      />,
    );

    expect(html).toContain("Timed out");
    expect(html).toContain("Step budget · 5 s");
    expect(html).not.toContain("No verdict");
  });

  it("renders an exact total-budget terminal as a quarantined timeout", () => {
    const html = renderToStaticMarkup(
      <EvalTimeoutCard
        node={evalCase({
          evalOutcome: "timed_out",
          timeoutBudget: "total",
          timeoutLimitMs: 30_000,
        })}
      />,
    );

    expect(html).toContain("Timed out");
    expect(html).toContain("Total budget · 30 s");
    expect(html).toContain(
      "Cancellation is cooperative; late Eval evidence was quarantined.",
    );
    expect(html).not.toContain("Cancelled");
  });

  it("renders the Tool name only for an exact Tool-budget terminal", () => {
    const html = renderToStaticMarkup(
      <EvalTimeoutCard
        node={evalCase({
          evalOutcome: "timed_out",
          timeoutBudget: "tool",
          timeoutLimitMs: 10_000,
          timeoutToolName: "search_docs",
        })}
      />,
    );

    expect(html).toContain("Tool budget · 10 s");
    expect(html).toContain("<code");
    expect(html).toContain("search_docs</code>");
  });

  it.each([
    ["legacy cancellation", {}],
    [
      "message-shaped legacy timeout",
      { error: "TimeoutError: total timeout after 30000 ms" },
    ],
    [
      "Tool terminal without a Tool name",
      {
        evalOutcome: "timed_out",
        timeoutBudget: "tool",
        timeoutLimitMs: 10_000,
      },
    ],
    [
      "non-Tool terminal with a Tool name",
      {
        evalOutcome: "timed_out",
        timeoutBudget: "total",
        timeoutLimitMs: 30_000,
        timeoutToolName: "search_docs",
      },
    ],
  ])("keeps %s on the generic Cancelled presentation", (_label, attributes) => {
    const html = renderToStaticMarkup(
      <EvalTimeoutCard node={evalCase(attributes)} />,
    );

    expect(html).toContain("Cancelled");
    expect(html).not.toContain("Timed out");
    expect(html).not.toContain("late Eval evidence was quarantined");
  });
});
