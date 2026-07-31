import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { ContextComposition } from "./ContextComposition";

vi.mock("@/app/navigation/useNavigation", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

describe("ContextComposition planning evidence", () => {
  it("renders the receipt, pressure boundaries, selected representations, and omission", () => {
    const node = {
      id: "span-planned",
      request: {
        mode: "exact",
        basePrompt: { sourceId: "support", text: "Base prompt." },
        messages: { system: "Base prompt.", messages: [] },
        plan: {
          requestId: "request_planned",
          model: "model-1",
          inputTokens: 800,
          maxInputTokens: 1200,
          measurement: "estimated",
          adaptations: [],
          warnings: [],
        },
        contributions: [
          {
            kind: "context.contribution",
            state: "active",
            included: true,
            sourceId: "prompt",
            injectableKind: "context",
            boundary: "required",
            representations: ["full"],
            selectedRepresentation: "full",
            order: 0,
          },
          {
            kind: "context.contribution",
            state: "active",
            included: true,
            sourceId: "style-full",
            injectableKind: "context",
            boundary: "sticky",
            representations: ["full", "authored"],
            selectedRepresentation: "authored",
            adaptation: {
              contributor: "style-full",
              representation: "authored",
              fullTokens: 1800,
              selectedTokens: 1000,
            },
            order: 1,
          },
          {
            kind: "context.contribution",
            state: "dropped-budget",
            included: false,
            sourceId: "reply-examples",
            injectableKind: "context",
            reason: "omitted by request planning",
            boundary: "elastic",
            representations: ["full", "omitted"],
            selectedRepresentation: "omitted",
            adaptation: {
              contributor: "reply-examples",
              representation: "omitted",
              fullTokens: 1600,
              selectedTokens: 800,
            },
            order: 2,
          },
        ],
        budget: {
          kind: "prompt.budget",
          usedTokens: 800,
          totalTokens: 1200,
          droppedCount: 1,
          dropped: [],
        },
        tools: [],
      },
      details: [],
      children: [],
    } as unknown as ObservabilityRunDetailNode;

    const html = renderToStaticMarkup(<ContextComposition node={node} />);

    expect(html).toContain("request_planned");
    expect(html).toContain("required");
    expect(html).toContain("style-full");
    expect(html).toContain("sticky");
    expect(html).toContain("full → authored alternative");
    expect(html).toContain("reply-examples");
    expect(html).toContain("elastic");
    expect(html).toContain("full → omitted");
    expect(html).toContain("1 dropped to fit");
  });
});
