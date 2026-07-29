import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { promptDefinitionRef } from "../../src/observability/definition-ref";
import { prompt } from "../../src/prompt/prompt";
import { configure } from "../../src/runtime/configure";
import { activePromptCatalogue } from "../../src/runtime/prompt-catalogue";
import { executeRuntimeBridgeCommand } from "../../src/runtime-bridge";
import { PromptPreviewCommandError } from "../../src/runtime-bridge/prompt-preview/execute";
import {
  PromptPreviewRequestValidationError,
  validatePromptPreviewRequest,
} from "../../src/runtime-bridge/prompt-preview/validate";

describe("exact prompt preview input", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("returns ordered validation issues without parsing twice", async () => {
    const refinement = vi.fn((value: string) => value === "valid");
    const value = prompt({
      id: "validated",
      input: z.object({
        name: z.string().min(3),
        code: z.string().refine(refinement, "Invalid code."),
      }),
      system: "validated",
    });
    dispose = configure({ prompts: [value] }).dispose;

    const result = await dispatch(value.id, {
      name: "x",
      code: "bad",
    });

    expect(refinement).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "validation-error",
      issues: [
        { path: ["name"] },
        { path: ["code"], message: "Invalid code." },
      ],
      omittedIssueCount: 0,
    });
  });

  it("accepts finite negative zero and nested null", async () => {
    const value = prompt({
      id: "json",
      input: z.object({
        number: z.number(),
        nested: z.object({ value: z.null() }),
      }),
      prompt: ({ input }) =>
        `${Object.is(input.number, -0)}:${input.nested.value === null}`,
    });
    dispose = configure({ prompts: [value] }).dispose;

    await expect(
      dispatch(value.id, { number: -0, nested: { value: null } }),
    ).resolves.toMatchObject({
      status: "ready",
      inspection: { prompt: { text: "true:true" } },
    });
  });

  it("rejects cyclic programmatic input before inspection", async () => {
    const inspect = vi.fn();
    const value = prompt({
      id: "cycle",
      input: z.object({ nested: z.unknown() }),
      prompt: inspect,
    });
    dispose = configure({ prompts: [value] }).dispose;
    const input: Record<string, unknown> = {};
    input.nested = input;

    await expect(dispatch(value.id, input)).rejects.toMatchObject({
      previewError: { code: "invalid_request" },
    } satisfies Partial<PromptPreviewCommandError>);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("retains the first 128 ordered issues and exact omitted count", async () => {
    const fields = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [
        `field${index.toString().padStart(3, "0")}`,
        z.string(),
      ]),
    );
    const value = prompt({
      id: "many-issues",
      input: z.object(fields),
      prompt: "safe",
    });
    dispose = configure({ prompts: [value] }).dispose;

    const result = await dispatch(value.id, {});

    expect(result).toMatchObject({
      status: "validation-error",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["field000"] }),
        expect.objectContaining({ path: ["field127"] }),
      ]),
      omittedIssueCount: 2,
    });
    expect((result as { issues: readonly unknown[] }).issues).toHaveLength(128);
  });

  it("treats a throwing refinement as an inspection failure", async () => {
    const value = prompt({
      id: "throwing-refinement",
      input: z.object({
        value: z.string().refine(() => {
          throw new Error("Trusted refinement failed.");
        }),
      }),
      prompt: "safe",
    });
    dispose = configure({ prompts: [value] }).dispose;

    await expect(
      dispatch(value.id, { value: "trigger" }),
    ).rejects.toMatchObject({
      previewError: {
        code: "inspection_failed",
        message: "Trusted refinement failed.",
      },
    });
  });

  it("enforces every structural input limit at exact equality", () => {
    const nested = (containers: number): Record<string, unknown> => {
      const root: Record<string, unknown> = {};
      let current = root;
      for (let index = 1; index < containers; index += 1) {
        const child: Record<string, unknown> = {};
        current.value = child;
        current = child;
      }
      return root;
    };
    const nodes = (elements: number) => ({ values: Array(elements).fill(0) });
    const keys = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`k${index}`, null]),
      );
    const weighted = (secondLength: number) => ({
      a: "a".repeat(65_536),
      b: "b".repeat(secondLength),
    });

    for (const input of [
      nested(32),
      nodes(9_998),
      keys(5_000),
      { ["k".repeat(256)]: true },
      { value: "x".repeat(65_536) },
      weighted(65_529),
    ]) {
      expect(() =>
        validatePromptPreviewRequest({ payload: { input } }),
      ).not.toThrow();
    }
    for (const input of [
      nested(33),
      nodes(9_999),
      keys(5_001),
      { ["k".repeat(257)]: true },
      { value: "x".repeat(65_537) },
      weighted(65_530),
    ]) {
      expect(() =>
        validatePromptPreviewRequest({ payload: { input } }),
      ).toThrow(PromptPreviewRequestValidationError);
    }
  });
});

async function dispatch(
  authoredId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const targetId = promptDefinitionRef(authoredId).id;
  return executeRuntimeBridgeCommand(
    {},
    {
      type: "command.request",
      commandId: "cmd",
      command: "prompt.previewExact",
      targetId,
      catalogueRevision: activePromptCatalogue().revision,
      payload: { input },
      deadlineMs: 1_000,
    },
  );
}
