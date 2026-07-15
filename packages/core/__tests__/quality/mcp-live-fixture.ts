import { z } from "zod";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterResponse } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import {
  mcpServerDefinitionRef,
  observe,
  toolDefinitionRef,
} from "../../src/observability";
import type { ToolSource } from "../../src/tools/tool-source";
import { withToolSourceProvenance } from "../../src/tools/tool-source";

/** Build a deterministic provider around a live-source materialization seam. */
export function createMcpQualityFixture(
  source: ToolSource,
  exposedName: string,
) {
  let discoveries = 0;
  let remoteCalls = 0;
  let providerCalls = 0;
  const usage = {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    inputTokenDetails: {},
    outputTokenDetails: {},
  } as const;
  const response = (
    text: string,
    toolCalls?: AdapterResponse["toolCalls"],
  ): AdapterResponse => ({
    text,
    toolCalls,
    usage,
    finishReason: toolCalls ? "tool_calls" : "stop",
  });
  const model = adapter({
    providerId: "quality-mcp",
    mapSettings: () => ({}),
    async materializeToolSource() {
      discoveries += 1;
      const discover = observe.openSpan({
        name: source.id,
        primitive: "mcp.discover",
        attributes: { sourceId: source.id },
        definitionRefs: [mcpServerDefinitionRef(source.id)],
      });
      discover.end({ attributes: { exposedToolCount: 1 } });
      return {
        tools: {
          [exposedName]: withToolSourceProvenance(
            {
              description: "Look up a catalog item.",
              parameters: z.object({ id: z.string() }),
              execute: async () => {
                remoteCalls += 1;
                return { live: true };
              },
            },
            {
              attributes: {
                sourceKind: "mcp",
                sourceId: source.id,
                exposedName,
                remoteName: "lookup",
              },
              definitionRefs: [
                mcpServerDefinitionRef(source.id),
                toolDefinitionRef(exposedName),
              ],
              causedBySpanIds: [discover.spanId],
            },
          ),
        },
        close: async () => {},
      };
    },
    async call() {
      providerCalls += 1;
      return {
        raw: { providerCalls },
        extracted:
          providerCalls === 1
            ? response("", [
                { id: "call-1", name: exposedName, args: { id: "42" } },
              ])
            : response("tool complete"),
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages: Message[]) {
      return messages;
    },
  })({});

  return {
    model,
    counts: () => ({ discoveries, providerCalls, remoteCalls }),
  };
}
