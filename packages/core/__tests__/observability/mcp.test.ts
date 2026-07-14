import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterResponse, ToolResultEntry } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import {
  createInMemoryObservabilityTransport,
  mcpServerDefinitionRef,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  toolDefinitionRef,
} from "../../src/observability";
import { prompt } from "../../src/prompt/prompt";
import {
  TOOL_SOURCE,
  withToolSourceProvenance,
  withToolSourceSessionProvenance,
} from "../../src/tools/tool-source";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

function response(
  text: string,
  toolCalls?: AdapterResponse["toolCalls"],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage,
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}

describe("MCP source observability", () => {
  afterEach(() => resetObservabilityRuntime());

  it("joins preparation, ordinary tool execution, and cleanup through generic source provenance", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = {
      _tag: "ToolSource" as const,
      id: "billing/catalog",
      kind: "fixture-mcp",
      [TOOL_SOURCE]: true as const,
    };
    const serverRef = mcpServerDefinitionRef(source.id);
    const exposedName = "billing_lookup";
    let providerCalls = 0;

    const model = adapter({
      providerId: "fixture-provider",
      mapSettings: () => ({}),
      async materializeToolSource() {
        const connect = observe.openSpan({
          name: source.id,
          primitive: "mcp.connect",
          attributes: {
            implementation: "fixture",
            sourceId: source.id,
            sourceSessionId: "source-session-1",
            transport: "fixture",
          },
          definitionRefs: [serverRef],
        });
        connect.end({
          attributes: { durationMs: 2, protocolVersion: "fixture-v1" },
        });

        const discover = observe.openSpan({
          name: source.id,
          primitive: "mcp.discover",
          attributes: {
            sourceId: source.id,
            sourceSessionId: "source-session-1",
            connectSpanId: connect.spanId,
          },
          definitionRefs: [serverRef],
        });
        const cleanupContext = discover.withContext(() => {
          observe.edge({
            edgeType: "caused",
            from: { kind: "span", id: connect.spanId },
            to: { kind: "span", id: discover.spanId },
          });
          return observe.captureContext();
        });
        discover.end({
          attributes: {
            discoveredToolCount: 1,
            exposedToolCount: 1,
            toolListFingerprint: "sha256:fixture",
          },
        });

        const tool = withToolSourceProvenance(
          {
            description: "Look up billing data.",
            parameters: z.object({ query: z.string() }),
            execute: async ({ query }: { query: string }) => ({
              query,
              found: true,
            }),
          },
          {
            attributes: {
              sourceKind: "mcp",
              sourceId: source.id,
              sourceSessionId: "source-session-1",
              connectSpanId: connect.spanId,
              discoverSpanId: discover.spanId,
              remoteName: "lookup",
              exposedName,
              inputSchemaFingerprint: "sha256:input",
              toolListFingerprint: "sha256:fixture",
              executionErrorState: "none",
            },
            definitionRefs: [serverRef, toolDefinitionRef(exposedName)],
            causedBySpanIds: [discover.spanId],
            errorAttributes: { executionErrorState: "error" },
          },
        );

        return withToolSourceSessionProvenance(
          { tools: { [exposedName]: tool }, close: async () => {} },
          {
            cleanupEvent: {
              name: "mcp.cleanup",
              context: cleanupContext,
              attributes: {
                sourceId: source.id,
                sourceSessionId: "source-session-1",
                connectSpanId: connect.spanId,
                discoverSpanId: discover.spanId,
              },
            },
          },
        );
      },
      async call() {
        providerCalls += 1;
        return {
          raw: { providerCalls },
          extracted:
            providerCalls === 1
              ? response("", [
                  {
                    id: "call-1",
                    name: exposedName,
                    args: { query: "invoice" },
                  },
                ])
              : response("done"),
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(
        messages: Message[],
        assistant: AdapterResponse,
        results: ToolResultEntry[],
      ) {
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
        id: "mcp-observability",
        use: [source],
        prompt: "Look up the invoice.",
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

    expect(connect?.definitionRefs).toContainEqual(serverRef);
    expect(discover?.definitionRefs).toContainEqual(serverRef);
    expect(call).toMatchObject({
      attributes: expect.objectContaining({
        sourceId: source.id,
        remoteName: "lookup",
        exposedName,
      }),
      definitionRefs: expect.arrayContaining([
        serverRef,
        toolDefinitionRef(exposedName),
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
          sourceId: source.id,
        }),
      }),
    );
  });
});
