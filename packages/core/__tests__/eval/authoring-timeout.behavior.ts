import { expect, it } from "vitest";
import { z } from "zod";

import { evaluate } from "../../src/eval";
import { getEvalDefinitionForInternalUse } from "../../src/eval/internal/definition";
import { normalizeCaseRow } from "../../src/eval/node/case-rows";
import { resolveEvalTimeoutPolicy } from "../../src/eval/timeout-policy";

/** Register the focused timeout-policy behavior in the authoring suite. */
export function defineTimeoutAuthoringBehavior(): void {
  it("normalizes, merges, and freezes semantic Eval timeout policies", () => {
    const evalTimeout = {
      totalMs: 1_200.9,
      stepMs: 900.8,
      chunkMs: 0,
      toolMs: Number.POSITIVE_INFINITY,
      tools: { search: 500.9, disabled: -1 },
    } as const;
    const authoredCases = [
      { id: "inherit", input: "inherit" },
      {
        id: "override",
        input: "override",
        timeout: {
          stepMs: 300.9,
          tools: { search: 250.7, lookup: 100.2 },
        },
      },
      {
        id: "clear",
        input: "clear",
        timeout: { stepMs: null, tools: { search: null } },
      },
      { id: "disabled", input: "disabled", timeout: { stepMs: -10 } },
      { id: "clear-all", input: "clear-all", timeout: null },
    ] as const;

    const definition = getEvalDefinitionForInternalUse(
      evaluate({
        task: async (input: string) => input,
        timeout: evalTimeout,
        cases: authoredCases,
      }),
    );
    const resolved = Object.fromEntries(
      definition.cases.map((authored) => [
        authored.id,
        resolveEvalTimeoutPolicy(definition.timeout, authored.timeout),
      ]),
    );

    expect(definition.timeout).toEqual({
      totalMs: 1_200,
      stepMs: 900,
      chunkMs: null,
      toolMs: null,
      tools: { disabled: null, search: 500 },
    });
    expect(definition.timeout).not.toBe(evalTimeout);
    expect(Object.isFrozen(definition.timeout)).toBe(true);
    expect(Object.isFrozen(definition.timeout?.tools)).toBe(true);
    expect(definition.cases[1]?.timeout).not.toBe(authoredCases[1].timeout);
    expect(definition.cases[1]?.timeout).toEqual({
      stepMs: 300,
      tools: { lookup: 100, search: 250 },
    });
    expect(definition.cases[4]?.timeout).toBeNull();

    expect(resolved).toMatchObject({
      inherit: {
        totalMs: 1_200,
        nested: {
          stepMs: 900,
          chunkMs: null,
          toolMs: null,
          tools: { disabled: null, search: 500 },
        },
      },
      override: {
        totalMs: 1_200,
        nested: {
          stepMs: 300,
          chunkMs: null,
          toolMs: null,
          tools: {
            disabled: null,
            lookup: 100,
            search: 250,
          },
        },
      },
      clear: {
        totalMs: 1_200,
        nested: {
          stepMs: null,
          chunkMs: null,
          toolMs: null,
          tools: { disabled: null, search: null },
        },
      },
      disabled: {
        totalMs: 1_200,
        nested: {
          stepMs: null,
          chunkMs: null,
          toolMs: null,
          tools: { disabled: null, search: 500 },
        },
      },
      "clear-all": {
        totalMs: null,
        nested: {
          stepMs: null,
          chunkMs: null,
          toolMs: null,
          tools: { disabled: null, search: null },
        },
      },
    });
    expect(resolved["clear-all"]?.nested).not.toHaveProperty("totalMs");
    expect(resolved["clear-all"]?.nested).not.toHaveProperty("firstToken");
    expect(Object.isFrozen(resolved.override)).toBe(true);
    expect(Object.isFrozen(resolved.override?.nested)).toBe(true);
    expect(Object.isFrozen(resolved.override?.nested.tools)).toBe(true);

    expect(evalTimeout).toEqual({
      totalMs: 1_200.9,
      stepMs: 900.8,
      chunkMs: 0,
      toolMs: Number.POSITIVE_INFINITY,
      tools: { search: 500.9, disabled: -1 },
    });
    expect(authoredCases[1]?.timeout).toEqual({
      stepMs: 300.9,
      tools: { search: 250.7, lookup: 100.2 },
    });
    expect(Object.isFrozen(evalTimeout)).toBe(false);
    expect(Object.isFrozen(authoredCases[1]?.timeout)).toBe(false);
  });

  it("normalizes timeout policies carried by file-backed Case rows", async () => {
    const source = {
      id: "file-case",
      input: "question",
      timeout: {
        totalMs: 1_000.9,
        stepMs: Number.NaN,
        tools: { search: 250.8 },
      },
    };

    const loaded = await normalizeCaseRow({
      value: source,
      displayPath: "cases.json",
      kind: "authored",
      inputSchema: z.string(),
    });

    expect(loaded.authored.timeout).toEqual({
      totalMs: 1_000,
      stepMs: null,
      tools: { search: 250 },
    });
    expect(Object.isFrozen(loaded.authored.timeout)).toBe(true);
    expect(Object.isFrozen(loaded.authored.timeout?.tools)).toBe(true);
    expect(source.timeout).toEqual({
      totalMs: 1_000.9,
      stepMs: Number.NaN,
      tools: { search: 250.8 },
    });
  });
}
