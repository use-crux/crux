import { describe, expect, it } from "vitest";

import { evaluate } from "../../src/eval";
import {
  projectEvalTimeoutPolicyForInternalUse,
  type EvalFacts,
} from "../../src/project-index";

const task = async (input: string) => input;
const cases = [{ input: "hello" }] as const;

describe("Eval Project Index timeout policy", () => {
  it("projects canonical authored and effective policy without private identity", () => {
    const missing = projectEvalTimeoutPolicyForInternalUse(
      evaluate({ task, cases }),
    );
    const empty = projectEvalTimeoutPolicyForInternalUse(
      evaluate({ task, cases, timeout: {} }),
    );
    const configured = projectEvalTimeoutPolicyForInternalUse(
      evaluate({
        task,
        cases,
        timeout: {
          totalMs: 30_000.9,
          firstToken: 1_500.8,
          toolMs: -1,
          tools: {
            search: 750.4,
            archive: Number.POSITIVE_INFINITY,
          },
        },
      }),
    );
    const cleared = projectEvalTimeoutPolicyForInternalUse(
      evaluate({ task, cases, timeout: null }),
    );

    expect(missing).toBeUndefined();
    expect(empty).toEqual({ authored: {}, effective: {} });
    expect(configured).toEqual({
      authored: {
        totalMs: 30_000,
        firstToken: 1_500,
        toolMs: null,
        tools: { archive: null, search: 750 },
      },
      effective: {
        totalMs: 30_000,
        firstToken: 1_500,
        toolMs: null,
        tools: { archive: null, search: 750 },
      },
    });
    expect(cleared).toEqual({ authored: null, effective: {} });
    expect(Object.keys(configured?.effective.tools ?? {})).toEqual([
      "archive",
      "search",
    ]);
    expect(Reflect.ownKeys(configured?.effective ?? {})).not.toContainEqual(
      expect.any(Symbol),
    );

    const facts = {
      kind: "eval",
      timeout: configured,
    } satisfies EvalFacts;
    expect(facts.timeout).toBe(configured);
  });
});
