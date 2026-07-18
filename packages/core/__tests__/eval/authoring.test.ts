import { describe, expect, it } from "vitest";
import { z } from "zod";

import { caseFile, evaluate } from "../../src/eval";
import { getEvalDefinitionForInternalUse } from "../../src/eval/internal/definition";

describe("evaluate()", () => {
  it("rejects unknown and removed top-level options with actionable remedies", () => {
    const base = {
      task: async (input: string) => input,
      cases: [{ input: "hello" }],
    };
    expect(() => evaluate({ ...base, typo: true } as never)).toThrowError(
      /unknown top-level option `typo`/i,
    );
    expect(() => evaluate({ ...base, dataset: [] } as never)).toThrowError(
      /`dataset` was removed.*use `cases`.*caseFile/i,
    );
    expect(() => evaluate({ ...base, baseline: "run" } as never)).toThrowError(
      /`baseline` was removed.*CLI or Devtools/i,
    );
  });

  it("defines one frozen inert Eval from an opaque task and inline Case", () => {
    const support = async (input: { question: string }) => ({
      answer: input.question,
    });

    const evalValue = evaluate({
      task: support,
      cases: [{ input: { question: "Can I get a refund?" } }],
    });

    expect(evalValue).toMatchObject({
      _tag: "CruxEval",
      id: undefined,
    });
    expect(Object.isFrozen(evalValue)).toBe(true);
    expect(evalValue).not.toHaveProperty("run");
    expect(evalValue).not.toHaveProperty("promote");
    expect(getEvalDefinitionForInternalUse(evalValue)).toMatchObject({
      schemaVersion: 1,
      task: support,
      caseFiles: [],
      variants: {},
      arms: [{ name: "current", overrideKeys: [] }],
      scorers: [],
      trials: 1,
      tags: [],
      covers: [],
    });
  });

  it("carries a frozen Current-first definition without cloning user-owned values", () => {
    const task = async (input: { question: string }) => input.question;
    const sharedExpect = () => undefined;
    const scorer = () => ({ name: "length", score: 1 });
    const candidate = { temperature: 0.2 };

    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "Refund?" } }],
      variants: { cheaper: candidate },
      expect: sharedExpect,
      scorers: [scorer],
      description: "Support quality",
      tags: ["support"],
      covers: ["prompt:support"],
    });

    const definition = getEvalDefinitionForInternalUse(evalValue);
    expect(definition).toMatchObject({
      schemaVersion: 1,
      explicitId: "support",
      task,
      trials: 1,
      description: "Support quality",
      tags: ["support"],
      covers: ["prompt:support"],
      arms: [
        { name: "current", overrideKeys: [] },
        { name: "cheaper", overrideKeys: ["temperature"] },
      ],
    });
    expect(definition.expect).toEqual({
      check: sharedExpect,
      requiresFresh: false,
    });
    expect(definition.expect?.check).toBe(sharedExpect);
    expect(Object.isFrozen(definition.expect)).toBe(true);
    expect(definition.scorers).toEqual([scorer]);
    expect(definition.variants.cheaper).not.toBe(candidate);
    expect(definition.variants.cheaper).toEqual(candidate);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.cases)).toBe(true);
    expect(Object.isFrozen(definition.variants)).toBe(true);
    expect(Object.isFrozen(task)).toBe(false);
    expect(Object.isFrozen(candidate)).toBe(false);
    expect(Object.isFrozen(scorer)).toBe(false);
  });

  it("normalizes fresh Eval and Case checks without cloning callbacks", () => {
    const evalCheck = () => undefined;
    const caseCheck = () => undefined;
    const afterScores = () => undefined;
    const evalValue = evaluate({
      task: async (input: { question: string }) => input.question,
      expect: { fresh: true, check: evalCheck },
      afterScores: { fresh: true, check: afterScores },
      cases: [
        {
          input: { question: "Refund?" },
          expect: { fresh: true, check: caseCheck },
        },
      ],
    });
    const definition = getEvalDefinitionForInternalUse(evalValue);

    expect(definition.expect).toEqual({
      check: evalCheck,
      requiresFresh: true,
    });
    expect(definition.afterScores).toEqual({
      check: afterScores,
      requiresFresh: true,
    });
    expect(definition.cases[0]?.expect).toEqual({
      check: caseCheck,
      requiresFresh: true,
    });
    expect(Object.isFrozen(definition.expect)).toBe(true);
    expect(Object.isFrozen(definition.afterScores)).toBe(true);
    expect(Object.isFrozen(definition.cases[0]?.expect)).toBe(true);
    expect(Object.isFrozen(evalCheck)).toBe(false);
    expect(Object.isFrozen(caseCheck)).toBe(false);
  });

  it("rejects malformed fresh checks and empty latency Gates", () => {
    const task = async (input: { question: string }) => input.question;
    const cases = [{ input: { question: "Refund?" } }];

    expect(() =>
      evaluate({ task, cases, expect: { fresh: false } as never }),
    ).toThrowError(/expect.*fresh: true.*check/i);
    expect(() =>
      evaluate({ task, cases, gates: { latency: {} } as never }),
    ).toThrowError(/latency.*meanMs.*p95Ms/i);
  });

  it("normalizes top-level Variant differences without freezing replacements", () => {
    const replacementPrompt = { id: "concise" };
    const replacementModel = { modelId: "mini" };
    const evalValue = evaluate({
      task: async (input: { question: string }) => input.question,
      cases: [{ input: { question: "Refund?" } }],
      variants: {
        cheaper: {
          prompt: replacementPrompt,
          model: replacementModel,
          temperature: 0.1,
        },
      } as never,
    });

    const definition = getEvalDefinitionForInternalUse(evalValue);
    expect(definition.arms[1]).toEqual({
      name: "cheaper",
      overrideKeys: ["prompt", "model", "temperature"],
    });
    expect(definition.variants.cheaper?.prompt).toBe(replacementPrompt);
    expect(definition.variants.cheaper?.model).toBe(replacementModel);
    expect(Object.isFrozen(definition.variants.cheaper)).toBe(true);
    expect(Object.isFrozen(replacementPrompt)).toBe(false);
    expect(Object.isFrozen(replacementModel)).toBe(false);
  });

  it.each(["current", "baseline"])(
    "rejects the reserved Variant name %s at runtime",
    (name) => {
      expect(() =>
        evaluate({
          task: async (input: { question: string }) => input.question,
          cases: [{ input: { question: "Refund?" } }],
          variants: { [name]: { temperature: 0.2 } },
        }),
      ).toThrowError(`evaluate(): Variant name '${name}' is reserved.`);
    },
  );

  it("stably separates mixed inline Cases and case-file references", () => {
    const inputSchema = z.object({ question: z.string() });
    const firstFile = caseFile("./support.cases.jsonl", { input: inputSchema });
    const secondFile = caseFile("./regressions.csv", { input: inputSchema });

    const evalValue = evaluate({
      task: async (input: { question: string }) => input.question,
      cases: [
        { id: "refund", input: { question: "Refund?" } },
        firstFile,
        { id: "shipping", input: { question: "Shipping?" } },
        secondFile,
      ],
    });

    const definition = getEvalDefinitionForInternalUse(evalValue);
    expect(definition.cases.map((item) => item.id)).toEqual([
      "refund",
      "shipping",
    ]);
    expect(definition.caseFiles.map((item) => item.path)).toEqual([
      "./support.cases.jsonl",
      "./regressions.csv",
    ]);
    expect(definition.caseSourceOrder).toEqual([
      { kind: "inline", index: 0 },
      { kind: "file", index: 0 },
      { kind: "inline", index: 1 },
      { kind: "file", index: 1 },
    ]);
    expect(definition.caseFiles[0]?.inputSchema).toBe(inputSchema);
    expect(Object.isFrozen(firstFile)).toBe(true);
    expect(Object.isFrozen(inputSchema)).toBe(false);
  });

  it("rejects an empty explicit Case id", () => {
    expect(() =>
      evaluate({
        task: async (input: { question: string }) => input.question,
        cases: [{ id: "  ", input: { question: "Refund?" } }],
      }),
    ).toThrowError(
      "evaluate(): a Case `id` must be a non-empty string when provided.",
    );
  });

  it("validates case-file arguments without changing schema ownership", () => {
    const inputSchema = z.object({ question: z.string() });

    expect(() => caseFile("", { input: inputSchema })).toThrowError(
      /non-empty string/,
    );
    expect(() =>
      caseFile("./cases.jsonl", { input: {} as never }),
    ).toThrowError(/Standard Schema/);
    expect(() =>
      caseFile("./cases.jsonl", {
        input: inputSchema,
        expected: {} as never,
      }),
    ).toThrowError(/`expected` must be a Standard Schema/);
    expect(Object.isFrozen(inputSchema)).toBe(false);
  });

  it("rejects malformed Variant containers and entries", () => {
    const task = async (input: { question: string }) => input.question;
    const cases = [{ input: { question: "Refund?" } }];

    expect(() => evaluate({ task, cases, variants: [] as never })).toThrowError(
      /record of override objects/,
    );
    expect(() =>
      evaluate({ task, cases, variants: { candidate: null } as never }),
    ).toThrowError(/Variant 'candidate' must be an override object/);
  });

  it("normalizes Case shells without freezing user-owned evidence", () => {
    const input = { question: "Refund?" };
    const expected = { answer: "Yes" };
    const tags = ["smoke"];
    const metadata = { source: "hand-authored" };
    const authoredCase = { input, expected, tags, metadata };

    const evalValue = evaluate({
      task: async (value: { question: string }) => value.question,
      cases: [authoredCase],
    });
    const normalized = getEvalDefinitionForInternalUse(evalValue).cases[0]!;

    expect(normalized).not.toBe(authoredCase);
    expect(normalized.input).toBe(input);
    expect(normalized.expected).toBe(expected);
    expect(normalized.tags).not.toBe(tags);
    expect(normalized.tags).toEqual(tags);
    expect(normalized.metadata).not.toBe(metadata);
    expect(normalized.metadata).toEqual(metadata);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.tags)).toBe(true);
    expect(Object.isFrozen(normalized.metadata)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(expected)).toBe(false);
    expect(Object.isFrozen(tags)).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(false);
  });
});
