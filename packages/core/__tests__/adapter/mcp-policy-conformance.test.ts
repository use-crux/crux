import { mcp, stdio } from "@use-crux/mcp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { prompt } from "../../src/prompt/prompt";
import { toolPolicy } from "../../src/safety/toolPolicy";
import { registerMcpMiddlewareConformanceTests } from "./mcp-middleware-conformance";
import { createMcpPolicyFixture } from "./mcp-policy-fixture";
import { registerMcpSafetyConformanceTests } from "./mcp-safety-conformance";
import { registerMcpToolPolicyObservabilityConformanceTests } from "./mcp-tool-policy-observability-conformance";

describe("MCP policy conformance", () => {
  registerMcpMiddlewareConformanceTests();
  registerMcpSafetyConformanceTests();
  registerMcpToolPolicyObservabilityConformanceTests();

  it("rewrites tool arguments before materialized transport execution", async () => {
    const transport = vi.fn(async (input: { query: string }) => ({
      content: [{ type: "text" as const, text: input.query }],
    }));
    const source = mcp({
      id: "args-rewrite-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-args-rewrite",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy.args({
        id: "normalize-query",
        match: "lookup",
        run: async ({ input }) => ({
          action: "rewrite",
          value: {
            input: {
              query: z.object({ query: z.string() }).parse(input).query.trim(),
            },
          },
          rewrite: { kind: "normalize" },
        }),
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a value.",
          parameters: z.object({ query: z.string() }),
          execute: transport,
        },
      },
      toolName: "lookup",
      input: { query: "  crux  " },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });

    expect(transport).toHaveBeenCalledWith(
      { query: "crux" },
      expect.objectContaining({ toolCallId: "mcp-call-1" }),
    );
  });

  it("blocks unsafe arguments before materialized transport execution", async () => {
    const transport = vi.fn(async () => ({ content: [] }));
    const source = mcp({
      id: "args-block-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-args-block",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy.args({
        id: "block-delete",
        match: "delete_record",
        run: async () => ({ action: "block", reason: "Deletion is blocked." }),
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        delete_record: {
          description: "Delete a record.",
          parameters: z.object({ id: z.string() }),
          execute: transport,
        },
      },
      toolName: "delete_record",
      input: { id: "record-1" },
    });

    await expect(
      fixture.adapter.generate(assistant, { model: "fixture-model" }),
    ).rejects.toMatchObject({
      name: "ToolPolicyBlockedError",
      policyId: "block-delete",
    });

    expect(transport).not.toHaveBeenCalled();
    expect(fixture.results()).toEqual([]);
  });

  it("rewrites materialized results before model-output conversion", async () => {
    const toModelOutput = vi.fn(
      ({ output }: { output: { email: string } }) => ({
        type: "text" as const,
        value: output.email,
      }),
    );
    const source = mcp({
      id: "result-rewrite-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-result-rewrite",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy.result({
        id: "redact-email",
        match: "lookup_user",
        run: async (subject) => ({
          action: "rewrite",
          value: { ...subject, output: { email: "[redacted]" } },
          rewrite: { kind: "redact" },
        }),
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup_user: {
          description: "Look up a user.",
          parameters: z.object({ id: z.string() }),
          execute: async () => ({ email: "ada@example.com" }),
          toModelOutput,
        },
      },
      toolName: "lookup_user",
      input: { id: "user-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });

    expect(toModelOutput).toHaveBeenCalledWith(
      expect.objectContaining({ output: { email: "[redacted]" } }),
    );
    expect(fixture.results()).toEqual([
      expect.objectContaining({
        output: { email: "[redacted]" },
        content: "[redacted]",
      }),
    ]);
  });

  it("blocks materialized results before model-output conversion", async () => {
    const transport = vi.fn(async () => ({ secret: "private" }));
    const toModelOutput = vi.fn(() => ({
      type: "text" as const,
      value: "must not be visible",
    }));
    const source = mcp({
      id: "result-block-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-result-block",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy.result({
        id: "block-secret",
        match: "lookup_secret",
        run: async () => ({
          action: "block",
          reason: "Secret result blocked.",
        }),
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup_secret: {
          description: "Look up a secret.",
          parameters: z.object({ id: z.string() }),
          execute: transport,
          toModelOutput,
        },
      },
      toolName: "lookup_secret",
      input: { id: "secret-1" },
    });

    await expect(
      fixture.adapter.generate(assistant, { model: "fixture-model" }),
    ).rejects.toMatchObject({
      name: "ToolPolicyBlockedError",
      policyId: "block-secret",
    });

    expect(transport).toHaveBeenCalledOnce();
    expect(toModelOutput).not.toHaveBeenCalled();
    expect(fixture.results()).toEqual([]);
  });

  it("requires declarative approval despite permissive MCP annotations", async () => {
    const transport = vi.fn(async () => ({ content: [] }));
    const source = mcp({
      id: "approval-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-approval",
      use: [source],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute: transport,
          mcp: {
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    const result = await fixture.adapter.generate(assistant, {
      model: "fixture-model",
      toolApproval: { inspect_record: "always" },
    });

    expect(transport).not.toHaveBeenCalled();
    expect(
      result.messages.flatMap(
        (message) => message.metadata?.toolApprovalRequests ?? [],
      ),
    ).toEqual([
      expect.objectContaining({
        toolName: "inspect_record",
        toolCallId: "mcp-call-1",
        input: { id: "record-1" },
      }),
    ]);
  });

  it("blocks a read-only annotated MCP tool when declarative policy blocks it", async () => {
    const transport = vi.fn(async () => ({ content: [] }));
    const source = mcp({
      id: "block-annotation-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-block-annotation",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "block-external-read",
        match: "inspect_record",
        action: "block",
        reason: "External reads are disabled.",
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute: transport,
          mcp: {
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    await expect(
      fixture.adapter.generate(assistant, { model: "fixture-model" }),
    ).rejects.toMatchObject({
      name: "ToolPolicyBlockedError",
      policyId: "block-external-read",
    });

    expect(transport).not.toHaveBeenCalled();
    expect(fixture.results()).toEqual([]);
  });
});
