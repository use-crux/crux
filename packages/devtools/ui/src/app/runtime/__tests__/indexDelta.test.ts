import { describe, expect, it } from "vitest";
import {
  applyIndexDelta,
  normalizeProjectIndexData,
  type IndexDeltaMessage,
} from "../indexDelta";
import type { IndexLintFinding, ProjectIdentity } from "@/types";
import { diagnostic, lintFinding, sourceRow } from "./indexDelta/fixtures";

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

  it.each([
    ["configured", { redactPatternsConfigured: true }, true],
    ["known off", { redactPatternsConfigured: false }, false],
  ] as const)(
    "normalizes %s project observability policy",
    (_name, observability, configured) => {
      const index = normalizeProjectIndexData({
        project: { root: "/repo", observability },
      });

      expect(index.project?.observability).toEqual({
        redactPatternsConfigured: configured,
      });
    },
  );

  it("preserves existing project identity fields while normalizing observability", () => {
    const index = normalizeProjectIndexData({
      project: {
        root: "/repo",
        name: "example",
        configFile: "/repo/crux.config.ts",
        runtimeConfigured: true,
        observability: { redactPatternsConfigured: true },
      },
    });

    expect(index.project).toEqual({
      root: "/repo",
      name: "example",
      configFile: "/repo/crux.config.ts",
      runtimeConfigured: true,
      observability: { redactPatternsConfigured: true },
    });
  });

  it.each([undefined, null, "unavailable", 0])(
    "keeps malformed or absent observability %p unknown",
    (observability) => {
      const index = normalizeProjectIndexData({
        project: {
          root: "/repo",
          observability,
        } as unknown as ProjectIdentity,
      });

      expect(index.project).not.toHaveProperty("observability");
    },
  );

  it("retains project observability during source-only deltas", () => {
    const current = normalizeProjectIndexData({
      project: {
        root: "/repo",
        observability: { redactPatternsConfigured: true },
      },
    });

    const next = applyIndexDelta(current, {
      type: "index:delta",
      generation: 2,
      file: "/repo/src/writer.ts",
      definitions: {},
    });

    expect(next?.project?.observability).toEqual({
      redactPatternsConfigured: true,
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

  it("preserves current file diagnostics when the delta omits diagnostics", () => {
    const file = "/repo/src/writer.ts";
    const diagnostics = [diagnostic("diagnostic:writer", file)];
    const current = normalizeProjectIndexData({ diagnostics });

    const next = applyIndexDelta(current, deltaFor(file));

    expect(next?.diagnostics).toEqual(diagnostics);
  });

  it("clears current file diagnostics when the delta supplies an empty replacement", () => {
    const file = "/repo/src/writer.ts";
    const other = diagnostic("diagnostic:other", "/repo/src/other.ts");
    const current = normalizeProjectIndexData({
      diagnostics: [diagnostic("diagnostic:writer", file), other],
    });

    const next = applyIndexDelta(current, {
      ...deltaFor(file),
      diagnostics: [],
    });

    expect(next?.diagnostics).toEqual([other]);
  });

  it("preserves the current source row when the delta omits sourceRow", () => {
    const file = "/repo/src/writer.ts";
    const sources = [sourceRow(file, "prompt:writer")];
    const current = normalizeProjectIndexData({ sources });

    const next = applyIndexDelta(current, deltaFor(file));

    expect(next?.sources).toEqual(sources);
  });

  it("removes the current source row when the delta supplies null", () => {
    const file = "/repo/src/writer.ts";
    const other = sourceRow("/repo/src/other.ts", "prompt:other");
    const current = normalizeProjectIndexData({
      sources: [sourceRow(file, "prompt:writer"), other],
    });

    const next = applyIndexDelta(current, {
      ...deltaFor(file),
      sourceRow: null,
    });

    expect(next?.sources).toEqual([other]);
  });

  it("replaces the current source row when the delta supplies a row", () => {
    const file = "/repo/src/writer.ts";
    const replacement = sourceRow(file, "prompt:writer:new");
    const current = normalizeProjectIndexData({
      sources: [sourceRow(file, "prompt:writer")],
    });

    const next = applyIndexDelta(current, {
      ...deltaFor(file),
      sourceRow: replacement,
    });

    expect(next?.sources).toEqual([replacement]);
  });
});

function deltaFor(file: string): IndexDeltaMessage {
  return {
    type: "index:delta",
    generation: 6,
    file,
    definitions: {},
  };
}
