import {
  createInMemoryObservabilityTransport,
  observe,
  prompt,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core";
import { toolPolicy } from "@use-crux/core/safety";
import { toolMiddleware } from "@use-crux/core/tool-middleware";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";
import { registerAiMcpSafetyPolicyCases } from "./mcp-safety-policy-cases";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeAiSdkMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);

describe("AI SDK-native MCP policy conformance", () => {
  beforeEach(() => {
    materializeMock.mockReset();
  });

  afterEach(() => {
    resetObservabilityRuntime();
  });

  registerAiMcpSafetyPolicyCases();

  it("records a tool-policy approval match on the SDK suspension span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    materializeMock.mockResolvedValue(nativeSession());
    const scripted = scriptedGateway({
      generateText: [
        {
          content: [
            {
              type: "tool-approval-request",
              toolCall: {
                toolCallId: "mcp-call-1",
                toolName: "lookup",
                input: { query: "crux" },
              },
            },
          ],
        },
      ],
    });
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        const tool = (args.tools as Record<string, unknown>).lookup as {
          needsApproval: (
            input: unknown,
            options: { toolCallId: string; messages: [] },
          ) => Promise<boolean>;
        };
        await expect(
          tool.needsApproval(
            { query: "crux" },
            { toolCallId: "mcp-call-1", messages: [] },
          ),
        ).resolves.toBe(true);
        return scripted.gateway.generateText(args);
      },
    };
    const assistant = prompt({
      id: "ai-native-mcp-approval",
      use: [mcpSource()],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "approve-lookup",
        match: "lookup",
        action: "requestApproval",
        reason: "Lookup needs approval.",
      }),
    });

    await createCruxAi({ gateway }).generate(assistant, {
      model: "test:model" as never,
    });
    await observe.flush();

    const report = transport.records.find(
      (record) =>
        record.type === "artifact" && record.kind === "security.report",
    );
    const approvalSpan = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "tool.approval" &&
        record.attributes?.phase === "request",
    );
    expect(report).toMatchObject({
      preview: {
        policyId: "approve-lookup",
        action: "request_approval",
        boundary: "approval.request",
      },
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "produced",
        from: {
          kind: "span",
          id:
            approvalSpan?.type === "span:start"
              ? approvalSpan.spanId
              : undefined,
        },
        to: {
          kind: "artifact",
          id: report?.type === "artifact" ? report.artifactId : undefined,
        },
      }),
    );
  });

  it("passes active MCP tool names through the AI SDK loop", async () => {
    materializeMock.mockResolvedValue({
      tools: {
        lookup: nativeTool(),
        hidden: nativeTool(),
      },
      close: vi.fn(async () => {}),
    } as never);
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });

    await createCruxAi({ gateway: scripted.gateway }).generate(
      prompt({
        id: "ai-native-mcp-active-tools",
        use: [mcpSource()],
        prompt: "Use lookup only.",
      }),
      {
        model: "test:model" as never,
        activeTools: ["lookup"],
      },
    );

    expect(scripted.calls.generateText[0]?.activeTools).toEqual(["lookup"]);
    expect(
      Object.keys(scripted.calls.generateText[0]?.tools as object),
    ).toEqual(expect.arrayContaining(["lookup", "hidden"]));
  });

  it("applies prompt and call middleware to AI-native MCP execution", async () => {
    const events: string[] = [];
    const execute = vi.fn(async (input: { value: string }) => {
      events.push(`execute:${input.value}`);
      return { value: input.value };
    });
    materializeMock.mockResolvedValue({
      tools: { lookup: nativeTool(execute) },
      close: vi.fn(async () => {}),
    } as never);
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        const tool = (args.tools as Record<string, unknown>).lookup as {
          execute: (
            input: { value: string },
            options: { toolCallId: string },
          ) => Promise<unknown>;
        };
        await tool.execute({ value: "x" }, { toolCallId: "mcp-call-1" });
        return scripted.gateway.generateText(args);
      },
    };
    const rewrite = (id: string, suffix: string) =>
      toolMiddleware({
        id,
        match: ["lookup"],
        aroundExecute: (call, next) => {
          events.push(`${id}:${call.toolName}`);
          const input = call.input as { value: string };
          return next({ value: `${input.value}${suffix}` }, call.options);
        },
      });

    await createCruxAi({ gateway }).generate(
      prompt({
        id: "ai-native-mcp-middleware",
        use: [mcpSource()],
        prompt: "Use the tool.",
        toolMiddleware: rewrite("prompt", "P"),
      }),
      {
        model: "test:model" as never,
        toolMiddleware: rewrite("call", "C"),
      },
    );

    expect(events).toEqual(["call:lookup", "prompt:lookup", "execute:xCP"]);
  });

  it("applies argument policy before AI-native MCP execution", async () => {
    const execute = vi.fn(async (input: { value: string }) => input);
    materializeMock.mockResolvedValue({
      tools: { lookup: nativeTool(execute) },
      close: vi.fn(async () => {}),
    } as never);
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        const tool = (args.tools as Record<string, unknown>).lookup as {
          execute: (
            input: { value: string },
            options: { toolCallId: string },
          ) => Promise<unknown>;
        };
        await tool.execute({ value: "  crux  " }, { toolCallId: "mcp-call-1" });
        return scripted.gateway.generateText(args);
      },
    };

    await createCruxAi({ gateway }).generate(
      prompt({
        id: "ai-native-mcp-args-policy",
        use: [mcpSource()],
        prompt: "Use the tool.",
        toolMiddleware: toolPolicy.args({
          id: "trim-query",
          match: "lookup",
          run: async (subject) => ({
            action: "rewrite",
            value: {
              ...subject,
              input: {
                value: (subject.input as { value: string }).value.trim(),
              },
            },
            rewrite: { kind: "normalize" },
          }),
        }),
      }),
      { model: "test:model" as never },
    );

    expect(execute).toHaveBeenCalledWith(
      { value: "crux" },
      expect.objectContaining({ toolCallId: "mcp-call-1" }),
    );
  });
});

function mcpSource() {
  return mcp({
    id: "ai-native-policy",
    transport: streamableHttp({ url: "https://mcp.example.test" }),
  });
}

function nativeSession() {
  return {
    tools: {
      lookup: nativeTool(),
    },
    close: vi.fn(async () => {}),
  } as never;
}

function nativeTool(
  execute: (input: { value: string }) => Promise<unknown> = async () => ({
    content: [],
  }),
) {
  return {
    description: "Look up a value.",
    inputSchema: { jsonSchema: { type: "object" } },
    execute,
    toModelOutput: ({ output }: { output: unknown }) => ({
      type: "json" as const,
      value: output,
    }),
  };
}
