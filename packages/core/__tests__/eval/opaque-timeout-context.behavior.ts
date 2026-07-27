import { describe, expect, it } from "vitest";

import { evalContext } from "../../src/eval";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { executeObservedOpaqueTaskForInternalUse } from "../../src/eval/internal/observed-task";
import { planEval } from "../../src/eval/internal/planner";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

/** Register opaque-task arity and explicit context forwarding behavior. */
export function opaqueTimeoutContextBehavior(): void {
  describe("opaque task timeout context", () => {
    it("preserves positional arity and forwards exact context only when asked", async () => {
      const authoredCall = Object.freeze({ locale: "en" });
      const forwarded: Array<{
        readonly signal: AbortSignal;
        readonly timeout: ReturnType<typeof evalContext>["timeout"];
      }> = [];
      let argumentCount = 0;
      const task = async function (
        input: { question: string },
        call: typeof authoredCall,
      ) {
        argumentCount = arguments.length;
        expect(input).toEqual({ question: "Refund?" });
        expect(call).toBe(authoredCall);
        const context = evalContext();
        forwarded.push(context);
        return "complete";
      };
      const evalValue = evaluate({
        id: "opaque-context",
        task,
        timeout: {
          totalMs: 1_000,
          stepMs: null,
          tools: { search: null },
        },
        cases: [
          {
            id: "case",
            input: { question: "Refund?" },
            call: authoredCall,
          },
        ],
      });
      const plan = await planEval(
        evalValue,
        {
          sourceKey: {
            relativeFile: "opaque-context.eval.ts",
            export: "default",
          },
        },
        nonBillablePlanningPorts(),
      );
      const run = await executeEvalPlan(plan, {
        taskHost: {
          execute: (request) =>
            executeObservedOpaqueTaskForInternalUse(request),
        },
        clock: { now: () => 10 },
        ids: { next: () => "opaque-context-run" },
        runStore: { write: async () => undefined },
      });

      expect(run.cells[0]).toMatchObject({
        status: "passed",
        output: "complete",
      });
      expect(argumentCount).toBe(2);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(forwarded[0]?.timeout).toBe(plan.cells[0]?.timeout.nested);
      expect(forwarded[0]?.timeout).toEqual({
        stepMs: null,
        tools: { search: null },
      });
      expect(authoredCall).toEqual({ locale: "en" });
      expect(authoredCall).not.toHaveProperty("signal");
      expect(authoredCall).not.toHaveProperty("timeout");
    });
  });
}
