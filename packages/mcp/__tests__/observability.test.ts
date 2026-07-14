import { adapter, prompt } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp, streamableHttp } from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];
const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

afterEach(async () => {
  resetObservabilityRuntime();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP observability", () => {
  it("records official preparation, ordinary execution, causality, and cleanup in one trace", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "lookup",
              description: "Look up an invoice.",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        },
      ],
      callTool: ({ arguments: input }) => ({
        content: [{ type: "text", text: `found:${String(input.query)}` }],
      }),
    });
    fixtures.push(fixture);
    const source = mcp({
      id: "billing/catalog",
      transport: streamableHttp({ url: fixture.url }),
      tools: { prefix: "billing_" },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let providerCalls = 0;
    const model = adapter({
      providerId: "fixture-provider",
      materializeToolSource: materializeMcpToolSource,
      mapSettings: () => ({}),
      async call() {
        providerCalls += 1;
        return {
          raw: { providerCalls },
          extracted: {
            text: providerCalls === 1 ? "" : "done",
            usage,
            responseId: `response-${providerCalls}`,
            actualModelId: "fixture-model",
            finishReason: providerCalls === 1 ? "tool-calls" : "stop",
            toolCalls:
              providerCalls === 1
                ? [
                    {
                      id: "call-1",
                      name: "billing_lookup",
                      args: { query: "invoice-7" },
                    },
                  ]
                : undefined,
          },
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages, assistant, results) {
        return [
          ...messages,
          { role: "assistant", content: assistant.text },
          ...results.map((result) => ({
            role: "tool" as const,
            content: result.content,
          })),
        ];
      },
    })({});

    await model.generate(
      prompt({
        id: "mcp-evidence",
        use: [source],
        prompt: "Find the invoice.",
      }),
      { model: "fixture-model" },
    );
    await observe.flush();

    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const connect = starts.find((record) => record.primitive === "mcp.connect");
    const discover = starts.find(
      (record) => record.primitive === "mcp.discover",
    );
    const call = starts.find((record) => record.primitive === "tool.call");
    const connectEnd = transport.records.find(
      (record) =>
        record.type === "span:end" && record.spanId === connect?.spanId,
    );
    const discoverEnd = transport.records.find(
      (record) =>
        record.type === "span:end" && record.spanId === discover?.spanId,
    );
    const serverRef = {
      id: "mcp.server:billing-catalog",
      kind: "mcp.server",
      role: "resolved-mcp-server",
    };

    expect(connect).toMatchObject({
      runId: discover?.runId,
      attributes: expect.objectContaining({
        implementation: "official-client",
        serverId: source.id,
      }),
      definitionRefs: [serverRef],
    });
    expect(connectEnd).toMatchObject({
      attributes: expect.objectContaining({
        transport: "streamable-http",
        serverName: "crux-mcp-test",
        serverVersion: "1.0.0",
      }),
    });
    expect(discover).toMatchObject({
      runId: call?.runId,
      definitionRefs: [serverRef],
    });
    expect(discoverEnd).toMatchObject({
      attributes: expect.objectContaining({
        pageCount: 1,
        discoveredToolCount: 1,
        selectedToolCount: 1,
        allowedToolCount: 1,
        deniedToolCount: 0,
        exposedToolCount: 1,
        toolListFingerprint: expect.stringMatching(/^sha256:/),
      }),
    });
    expect(call).toMatchObject({
      attributes: expect.objectContaining({
        remoteName: "lookup",
        exposedName: "billing_lookup",
        mcpErrorState: "none",
      }),
      definitionRefs: expect.arrayContaining([
        serverRef,
        {
          id: "tool:billing_lookup",
          kind: "tool",
          role: "invoked-tool",
        },
      ]),
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "caused",
        from: { kind: "span", id: discover?.spanId },
        to: { kind: "span", id: call?.spanId },
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:event",
        name: "mcp.cleanup",
        attributes: expect.objectContaining({
          outcome: "ok",
          serverId: source.id,
        }),
      }),
    );
    expect(fixture.toolCalls).toEqual([
      { name: "lookup", arguments: { query: "invoice-7" } },
    ]);
  });
});
