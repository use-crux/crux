import {
  createInMemoryObservabilityTransport,
  mcpServerDefinitionRef,
  observe,
  prompt,
  resetObservabilityRuntime,
  setObservabilityTransport,
  toolDefinitionRef,
  withToolSourceProvenance,
} from "@use-crux/core";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeAiSdkMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);

describe("AI SDK MCP observability", () => {
  beforeEach(() => materializeMock.mockReset());
  afterEach(() => resetObservabilityRuntime());

  it("preserves source provenance on the ordinary lifecycle-wrapped tool.call", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = mcp({
      id: "ai-observed-server",
      transport: streamableHttp({ url: "https://mcp.example.test" }),
    });
    const serverRef = mcpServerDefinitionRef(source.id);
    const toolRef = toolDefinitionRef("lookup");
    materializeMock.mockImplementation(async () => {
      const discover = observe.openSpan({
        name: source.id,
        primitive: "mcp.discover",
        attributes: { sourceId: source.id },
        definitionRefs: [serverRef],
      });
      discover.end({ attributes: { exposedToolCount: 1 } });
      return {
        tools: {
          lookup: withToolSourceProvenance(
            {
              description: "Look up a value",
              inputSchema: { jsonSchema: { type: "object" } },
              execute: async () => ({ value: 42 }),
              toModelOutput: ({ output }: { output: unknown }) => ({
                type: "json" as const,
                value: output,
              }),
            },
            {
              attributes: {
                sourceKind: "mcp",
                sourceId: source.id,
                remoteName: "lookup",
                exposedName: "lookup",
              },
              definitionRefs: [serverRef, toolRef],
              causedBySpanIds: [discover.spanId],
            },
          ),
        },
        close: async () => {},
      } as never;
    });
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        const tool = (
          args.tools as Record<
            string,
            { execute?: (input: unknown, options: unknown) => Promise<unknown> }
          >
        ).lookup;
        await tool?.execute?.({}, { toolCallId: "call-1" });
        return scripted.gateway.generateText(args);
      },
    };

    await createCruxAi({ gateway }).generate(
      prompt({
        id: "ai-observed-mcp",
        use: [source],
        prompt: "Look it up.",
      }),
      { model: "test:model" as never },
    );
    await observe.flush();

    const call = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "tool.call",
    );
    expect(call).toMatchObject({
      attributes: expect.objectContaining({
        sourceId: source.id,
        exposedName: "lookup",
      }),
      definitionRefs: expect.arrayContaining([serverRef, toolRef]),
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "caused",
        to: { kind: "span", id: call && "spanId" in call ? call.spanId : "" },
      }),
    );
  });
});
