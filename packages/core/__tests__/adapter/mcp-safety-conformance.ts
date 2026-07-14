import { mcp, stdio } from "@use-crux/mcp";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  boundary,
  constraint,
  guardrail,
  GuardrailBlockedError,
} from "../../src/safety";
import { prompt } from "../../src/prompt/prompt";
import { registerMcpLifecycleOptionsConformanceTests } from "./mcp-lifecycle-options-conformance";
import { createMcpPolicyFixture } from "./mcp-policy-fixture";

/** Registers guardrail and constraint cases for MCP-assisted generations. */
export function registerMcpSafetyConformanceTests(): void {
  registerMcpLifecycleOptionsConformanceTests();

  it("blocks unsafe input before connecting to an MCP server", async () => {
    const run = vi.fn(async () => ({
      action: "block" as const,
      reason: "Unsafe input blocked.",
    }));
    const assistant = prompt({
      id: "mcp-input-guard",
      use: [
        mcp({
          id: "input-guard-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Unsafe request",
    });
    const fixture = createMcpPolicyFixture({
      tools: {},
      toolName: "unused",
      input: {},
    });

    await expect(
      fixture.adapter.generate(assistant, {
        model: "fixture-model",
        guardrails: [
          guardrail({
            id: "block-input",
            on: boundary.input.text(),
            run,
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(run).toHaveBeenCalledOnce();
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it("applies output guardrails to MCP-assisted final output", async () => {
    const run = vi.fn(async (text: string) => ({
      action: "rewrite" as const,
      value: text.replace("private", "[redacted]"),
      rewrite: { kind: "redact" as const },
    }));
    const assistant = prompt({
      id: "mcp-output-guard",
      use: [
        mcp({
          id: "output-guard-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a record.",
          parameters: z.object({}),
          execute: async () => ({ value: "private" }),
        },
      },
      toolName: "lookup",
      input: {},
      finalText: "MCP returned private data.",
    });

    const result = await fixture.adapter.generate(assistant, {
      model: "fixture-model",
      guardrails: [
        guardrail({
          id: "redact-output",
          on: boundary.output.text(),
          run,
        }),
      ],
    });

    expect(run).toHaveBeenCalledWith(
      "MCP returned private data.",
      expect.objectContaining({
        boundary: { id: "model.output.text", kind: "model.output.text" },
      }),
    );
    expect(result.text).toBe("MCP returned [redacted] data.");
  });

  it("retries MCP-assisted output when a constraint requests correction", async () => {
    const execute = vi.fn(async () => ({ source: "guide" }));
    const run = vi.fn(async (text: string) =>
      text.includes("[1]")
        ? { pass: true as const }
        : { pass: false as const, feedback: "Add a source citation." },
    );
    const assistant = prompt({
      id: "mcp-output-constraint",
      use: [
        mcp({
          id: "output-constraint-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a source.",
          parameters: z.object({}),
          execute,
        },
      },
      toolName: "lookup",
      input: {},
      finalText: (providerCall) =>
        providerCall === 2
          ? "MCP says the claim is true."
          : "The claim is true [1].",
    });

    const result = await fixture.adapter.generate(assistant, {
      model: "fixture-model",
      constraints: [
        constraint({
          id: "require-citation",
          on: boundary.output.text(),
          maxRetries: 1,
          run,
        }),
      ],
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([text]) => text)).toEqual([
      "MCP says the claim is true.",
      "The claim is true [1].",
    ]);
    expect(result.text).toBe("The claim is true [1].");
  });
}
