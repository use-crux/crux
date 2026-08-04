import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import { indexSectionOrder } from "./detail";
import { IndexSessionDetail } from "./session-catalog";

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "agent:support",
      kind: "agent",
      name: "support",
      fidelity: "resolved",
    },
    {
      id: "session:src-support.ts:12:7",
      kind: "session",
      name: "supportSession",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "session",
          operation: "create",
          targetVariable: "support",
          targetDefinitionId: "agent:support",
          target: { kind: "agent" },
          key: { kind: "literal", value: "customer-42" },
          identity: "static",
          call: { kind: "supported" },
        },
      },
    },
  ],
  relations: [
    {
      id: "session-target",
      type: "session.targets_agent",
      from: "session:src-support.ts:12:7",
      to: "agent:support",
      fidelity: "resolved",
    },
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

describe("Session Catalog detail", () => {
  it("renders declaration, resolved target, and authored key evidence", () => {
    const index = buildIndex(data);
    const definition = index.byId("session:src-support.ts:12:7")!;
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <IndexSessionDetail def={definition} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );

    expect(html).toContain("Session declaration");
    expect(html).toContain("create");
    expect(html).toContain("static identity");
    expect(html).toContain("agent:support");
    expect(html).toContain("support");
    expect(html).toContain("literal");
    expect(html).toContain("customer-42");
    expect(html).toContain('type="button"');
    expect(indexSectionOrder(definition)).toEqual([
      "hero",
      "session",
      "relations",
      "source",
      "observability",
      "health",
    ]);
  });
});
