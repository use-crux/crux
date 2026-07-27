import { expect, it } from "vitest";
import { evalContext } from "../../src/eval";
import { withEvalContext } from "../../src/eval/testing";
import {
  resolveTimeoutOverrideForInternalUse,
  toolBudgetMs,
} from "../../src/generation/timeout";

/** Register intact Eval ceiling ownership and clone fallback behavior. */
export function evalTimeoutCeilingBehavior(): void {
  it("clamps only intact marked Eval timeout objects", () =>
    withEvalContext(
      {
        signal: new AbortController().signal,
        timeout: {
          stepMs: 50,
          toolMs: 70,
          tools: { lookup: 25, disabled: null },
        },
      },
      () => {
        const marked = evalContext().timeout;
        const production = {
          totalMs: 5_000,
          stepMs: 100,
          toolMs: 80,
          tools: { lookup: 60, disabled: null },
        };
        const clamped = resolveTimeoutOverrideForInternalUse(
          production,
          marked,
        );
        const cloned = resolveTimeoutOverrideForInternalUse(production, {
          ...marked,
        });

        expect(clamped).toMatchObject({
          totalMs: 5_000,
          stepMs: 50,
          toolMs: 70,
        });
        expect(toolBudgetMs(clamped, "lookup")).toBe(25);
        expect(toolBudgetMs(clamped, "disabled")).toBeUndefined();
        expect(cloned).toEqual({ ...marked });
        expect(production).toEqual({
          totalMs: 5_000,
          stepMs: 100,
          toolMs: 80,
          tools: { lookup: 60, disabled: null },
        });
      },
    ));
}
