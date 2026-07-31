import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import {
  projectEvidenceAuthoringCatalog,
  projectEvidenceCoverageCatalog,
} from "./evidence-catalog";

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
        privatePayload: "SECRET_PAYLOAD",
        subject: "SECRET_SUBJECT",
        idempotencyKey: "SECRET_KEY",
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
  lintFindings: [
    {
      id: "lint:evidence",
      ruleId: "evidence.reserved-inline-kind",
      severity: "error",
      category: "contracts",
      maturity: "experimental",
      confidence: "high",
      profiles: ["recommended", "strict"],
      title: "Reserved kind",
      message: "Use custom.* for inline evidence.",
      rationale: "Canonical inline kinds are invalid.",
      primaryDefinitionId: "evidence.record:src-agent.ts:18:5",
      relatedDefinitionIds: [],
      evidence: [],
      fixes: [
        {
          title: "Use a custom kind",
          description: "Change the kind to custom.review.",
          kind: "manual",
        },
      ],
      docsUrl: "https://cruxjs.dev/docs/reference/evidence",
    },
  ],
  sources: [],
} satisfies ProjectIndexData;

describe("Evidence Catalog projection", () => {
  it("projects only safe authored facts, source, diagnostics, and declared-in owner", () => {
    const index = buildIndex(data);
    const view = projectEvidenceAuthoringCatalog(
      index.byId("evidence.record:src-agent.ts:18:5")!,
      index,
    );

    expect(view).toMatchObject({
      source: { file: "src/agent.ts", line: 18, column: 5 },
      facts: {
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
      owner: { id: "agent:writer", name: "writer", kind: "agent" },
      findings: [
        expect.objectContaining({
          ruleId: "evidence.reserved-inline-kind",
          message: "Use custom.* for inline evidence.",
        }),
      ],
    });
    expect(JSON.stringify(view)).not.toMatch(
      /SECRET_PAYLOAD|SECRET_SUBJECT|SECRET_KEY/,
    );
  });

  it("distinguishes exact observations from owner-only correlation", () => {
    const index = buildIndex(data);
    const definition = index.byId("evidence.record:src-agent.ts:18:5")!;

    expect(
      projectEvidenceAuthoringCatalog(definition, index, {
        exactRunCount: 2,
        ownerRunCount: 7,
      })!.observation,
    ).toEqual({
      kind: "exact",
      definitionId: definition.id,
      runCount: 2,
      label: "Observed as this authoring definition",
    });

    expect(
      projectEvidenceAuthoringCatalog(definition, index, {
        ownerRunCount: 7,
      })!.observation,
    ).toEqual({
      kind: "owner",
      definitionId: "agent:writer",
      runCount: 7,
      label: "Observed through writer",
    });
  });

  it("never turns an owner observation into a callsite-executed claim", () => {
    const index = buildIndex(data);
    const view = projectEvidenceAuthoringCatalog(
      index.byId("evidence.record:src-agent.ts:18:5")!,
      index,
      { ownerRunCount: 1 },
    );

    expect(JSON.stringify(view)).not.toMatch(
      /callsite executed|record call executed|executed here/i,
    );
  });

  it("composes all five role rows from the generated primitive descriptor", () => {
    const view = projectEvidenceCoverageCatalog("workspace", {
      window: "Last 50 runs",
      countsByPrimitive: { "workspace.operation": 3 },
    });

    expect(view?.roles.map((role) => role.role)).toEqual([
      "intent",
      "authority",
      "change",
      "verification",
      "recovery",
    ]);
    expect(view?.roles.find((role) => role.role === "change")).toMatchObject({
      entries: [
        {
          primitive: "workspace.operation",
          status: "automatic",
          sourceKinds: ["output"],
          producer: "workspace/observability.emitWorkspaceArtifact",
        },
      ],
    });
    expect(view?.roles.find((role) => role.role === "recovery")).toMatchObject({
      entries: [
        {
          primitive: "workspace.operation",
          status: "blocked",
          followUp: "https://github.com/use-crux/crux/issues/258",
        },
      ],
    });
    expect(view?.runtime).toEqual({
      window: "Last 50 runs",
      counts: [{ primitive: "workspace.operation", count: 3 }],
    });
  });

  it("keeps caller-authored and explicit statuses visible without runtime inference", () => {
    const tool = projectEvidenceCoverageCatalog("tool");
    expect(tool?.roles.find((role) => role.role === "intent")?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          primitive: "tool.call",
          status: "automatic",
          sourceKinds: ["tool.args"],
        }),
        expect.objectContaining({
          primitive: "tool.approval",
          status: "caller-authored",
        }),
      ]),
    );

    const before = projectEvidenceCoverageCatalog("workspace");
    const after = projectEvidenceCoverageCatalog("workspace", {
      window: "Last 50 runs",
      countsByPrimitive: { "workspace.operation": 99 },
    });
    expect(after?.roles).toEqual(before?.roles);
  });
});
