import { describe, expect, it } from "vitest";
import {
  applyIndexDelta,
  normalizeProjectIndexData,
  type IndexDeltaMessage,
} from "../indexDelta";
import type { IndexLintFinding } from "@/types";

describe("index delta application", () => {
  it("preserves snapshot session metadata during normalization", () => {
    const index = normalizeProjectIndexData({
      projectRoot: "/repo",
      serverVersion: "0.6.0",
      generation: 12,
    });

    expect(index).toMatchObject({
      projectRoot: "/repo",
      serverVersion: "0.6.0",
      generation: 12,
    });
  });

  it("updates one source file without replacing the full index cache", () => {
    const file = "/repo/src/writer.ts";
    const current = normalizeProjectIndexData({
      definitions: [
        {
          id: "prompt:writer",
          kind: "prompt",
          name: "writer",
          fidelity: "resolved",
          status: "active",
          description: "old",
          source: { file, line: 1 },
        },
        {
          id: "prompt:other",
          kind: "prompt",
          name: "other",
          fidelity: "resolved",
          status: "active",
          source: { file: "/repo/src/other.ts", line: 1 },
        },
      ],
      diagnostics: [
        {
          id: "diagnostic:writer:old",
          severity: "info",
          code: "index.old",
          message: "Old",
          source: { file, line: 1 },
        },
        {
          id: "diagnostic:other",
          severity: "info",
          code: "index.other",
          message: "Other",
          source: { file: "/repo/src/other.ts", line: 1 },
        },
      ],
      sources: [
        {
          file,
          status: "indexed",
          definitionIds: ["prompt:writer"],
          diagnostics: ["diagnostic:writer:old"],
        },
        {
          file: "/repo/src/other.ts",
          status: "indexed",
          definitionIds: ["prompt:other"],
        },
      ],
    });
    const delta = {
      type: "index:delta",
      generation: 2,
      file,
      definitions: {
        changed: [
          {
            id: "prompt:writer",
            kind: "prompt",
            name: "writer",
            fidelity: "resolved",
            status: "active",
            description: "new",
            source: { file, line: 1 },
          },
        ],
        removedIds: [],
      },
      diagnostics: [
        {
          id: "diagnostic:writer:new",
          severity: "warning",
          code: "index.new",
          message: "New",
          source: { file, line: 1 },
        },
      ],
      sourceRow: {
        file,
        status: "indexed",
        definitionIds: ["prompt:writer"],
        diagnostics: ["diagnostic:writer:new"],
      },
    } satisfies IndexDeltaMessage;

    const next = applyIndexDelta(current, delta);

    expect(
      next?.definitions.map((definition) => [
        definition.id,
        definition.description,
      ]),
    ).toEqual([
      ["prompt:writer", "new"],
      ["prompt:other", undefined],
    ]);
    expect(next?.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "diagnostic:other",
      "diagnostic:writer:new",
    ]);
    expect(
      next?.sources.find((source) => source.file === file)?.diagnostics,
    ).toEqual(["diagnostic:writer:new"]);
  });

  it("replaces lint findings for the changed file", () => {
    const file = "/repo/src/writer.ts";
    const other = lintFinding("lint:other", "/repo/src/other.ts");
    const replacement = lintFinding("lint:writer:new", file);
    const current = normalizeProjectIndexData({
      lintFindings: [lintFinding("lint:writer:old", file), other],
    });
    const delta = {
      type: "index:delta",
      generation: 2,
      file,
      definitions: {},
      lints: { findings: [replacement] },
    } satisfies IndexDeltaMessage;

    const next = applyIndexDelta(current, delta);

    expect(next?.lintFindings).toEqual([other, replacement]);
  });

  it("clears lint findings for a file with an empty replacement", () => {
    const file = "/repo/src/writer.ts";
    const other = lintFinding("lint:other", "/repo/src/other.ts");
    const current = normalizeProjectIndexData({
      lintFindings: [lintFinding("lint:writer", file), other],
    });

    const next = applyIndexDelta(current, {
      type: "index:delta",
      generation: 3,
      file,
      definitions: {},
      lints: { findings: [] },
    });

    expect(next?.lintFindings).toEqual([other]);
  });

  it("uses the empty file anchor for project-level lint findings", () => {
    const sourceFinding = lintFinding("lint:source", "/repo/src/writer.ts");
    const replacement = lintFinding("lint:project:new");
    const projectDiagnostic = {
      id: "diagnostic:project",
      severity: "info" as const,
      code: "index.project",
      message: "Project diagnostic",
    };
    const current = normalizeProjectIndexData({
      lintFindings: [lintFinding("lint:project:old"), sourceFinding],
      diagnostics: [projectDiagnostic],
    });

    const next = applyIndexDelta(current, {
      type: "index:delta",
      generation: 4,
      file: "",
      definitions: {},
      diagnostics: [projectDiagnostic],
      lints: { findings: [replacement] },
    });

    expect(next?.lintFindings).toEqual([sourceFinding, replacement]);
    expect(next?.diagnostics).toEqual([projectDiagnostic]);
  });

  it("preserves lint findings when the delta omits the lint section", () => {
    const findings = [lintFinding("lint:writer", "/repo/src/writer.ts")];
    const current = normalizeProjectIndexData({ lintFindings: findings });

    const next = applyIndexDelta(current, {
      type: "index:delta",
      generation: 5,
      file: "/repo/src/writer.ts",
      definitions: {},
    });

    expect(next?.lintFindings).toEqual(findings);
  });
});

function lintFinding(id: string, file?: string): IndexLintFinding {
  return {
    id,
    severity: "info",
    ruleId: "prompt.missing_input_schema",
    category: "contracts",
    maturity: "stable",
    confidence: "high",
    profiles: ["recommended"],
    title: "Prompt has no input schema",
    message: "The prompt has no input schema.",
    rationale: "Prompt inputs should be inspectable.",
    source: file ? { file, line: 1 } : undefined,
    relatedDefinitionIds: [],
    evidence: [],
    fixes: [],
    docsUrl: "https://cruxjs.dev/docs/lints/prompt-missing-input-schema",
  };
}
