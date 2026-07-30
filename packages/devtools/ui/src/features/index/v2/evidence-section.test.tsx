import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import { IndexEvidence } from "./evidence-section";

vi.mock("@/shared/query/useDefinitionActivity", () => ({
  useDefinitionActivity: (definitionId?: string) => ({
    activity:
      definitionId === "agent:writer"
        ? { definitionId, runCount: 4 }
        : definitionId === "workspace:repo"
          ? { definitionId, runCount: 2 }
          : undefined,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/app/navigation/useNavigation", () => ({
  useNavigation: () => ({
    nav: { view: "overview" },
    navigate: () => undefined,
    isNavigating: false,
  }),
}));

const data = {
  project: { root: "/repo" },
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "agent:writer",
      kind: "agent",
      name: "writer",
      fidelity: "resolved",
    },
    {
      id: "workspace:repo",
      kind: "workspace",
      name: "repo",
      fidelity: "resolved",
    },
    {
      id: "evidence.record:src-agent.ts:18:5",
      kind: "evidence.record",
      name: "record",
      fidelity: "resolved",
      source: { file: "/repo/src/agent.ts", line: 18, column: 5 },
      metadata: {
        facts: {
          kind: "evidence.record",
          role: "verification",
          evidenceKind: {
            classification: "custom",
            value: "custom.review",
          },
          conclusion: "passed",
          sourceForm: "inline",
          subjectMode: "explicit",
          idempotent: true,
          supersedes: false,
        },
      },
    },
  ],
  relations: [
    {
      id: "relation:evidence-owner",
      type: "evidence.record.declared_in",
      from: "evidence.record:src-agent.ts:18:5",
      to: "agent:writer",
      fidelity: "resolved",
    },
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

function render(definitionId: string): string {
  const index = buildIndex(data);
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexSelectProvider select={() => undefined}>
        <IndexEvidence def={index.byId(definitionId)!} />
      </IndexSelectProvider>
    </IndexIndexProvider>,
  );
}

describe("Evidence Catalog detail", () => {
  it("renders purpose-built authoring facts, source, owner navigation, and honest correlation", () => {
    const html = render("evidence.record:src-agent.ts:18:5");
    expect(html).toContain("Evidence authoring");
    expect(html).toContain("verification");
    expect(html).toContain("custom.review");
    expect(html).toContain("passed");
    expect(html).toContain("src/agent.ts:18:5");
    expect(html).toContain("Declared in writer");
    expect(html).toContain("Observed through writer");
    expect(html).not.toMatch(/callsite executed|executed here/i);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open Catalog definition writer"');
  });

  it("renders a responsive, theme-token-safe five-role matrix and quiet runtime note", () => {
    const html = render("workspace:repo");
    expect(html).toContain("Evidence coverage");
    for (const role of [
      "Intent",
      "Authority",
      "Change",
      "Verification",
      "Recovery",
    ]) {
      expect(html).toContain(role);
    }
    expect(html).toContain("Automatic");
    expect(html).toContain("Caller-authored");
    expect(html).toContain("Blocked");
    expect(html).toContain("workspace/observability.emitWorkspaceArtifact");
    expect(html).toContain("Current local window · 2 runs");
    expect(html).toContain("repeat(auto-fit,minmax(150px,1fr))");
    expect(html).toMatch(/var\(--/);
  });
});
