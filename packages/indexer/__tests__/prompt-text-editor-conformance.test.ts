import { readFileSync, writeFileSync } from "node:fs";
import {
  PromptTextDiagnosticEvidenceSchema,
  type IndexDiagnostic,
} from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectPromptTextDiagnosticConclusions,
  type PromptTextDiagnosticConclusion,
} from "../src/indexer/semantic/evidence/prompt-text-diagnostics";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

const sourceUrl = new URL(
  "./fixtures/prompt-text-editor-conformance-v1.ts",
  import.meta.url,
);
const fixtureUrl = new URL(
  "./fixtures/prompt-text-editor-conformance-v1.json",
  import.meta.url,
);
const source = readFileSync(sourceUrl, "utf8");
const canonicalFile = "/repo/src/prompt-text-editor-conformance-v1.ts";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("shared PromptText editor conformance source", () => {
  it("matches the shared semantic evidence and suppresses the impostor", async () => {
    const { facts, file } = await promptTextDiagnosticFacts(source);
    const diagnostics = facts.diagnostics ?? [];
    const promptTextRefs = (facts.sourceRefs ?? []).filter(
      (sourceRef) => sourceRef.ref.metadata?.promptText !== undefined,
    );
    const owner = promptTextRefs.find(
      (sourceRef) =>
        sourceRef.definitionId === "prompt:editor-conformance" &&
        sourceRef.ref.metadata?.promptText?.sourceKind === "owner",
    );
    if (owner === undefined) {
      throw new Error("canonical conformance owner source ref is absent");
    }

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
    ]);
    expect(
      diagnostics.map((diagnostic) => diagnostic.relatedDefinitionIds),
    ).toEqual([
      ["prompt:editor-conformance"],
      ["prompt:editor-conformance"],
      ["prompt:editor-conformance"],
    ]);
    expect(
      diagnostics.map((diagnostic) => diagnostic.evidence?.cause.kind),
    ).toEqual([
      "inline-sequence",
      "invalid-interpolation",
      "json-serialization",
    ]);
    expect(
      promptTextRefs.map((sourceRef) => ({
        owner: sourceRef.definitionId,
        sourceKind: sourceRef.ref.metadata?.promptText?.sourceKind,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          owner: "prompt:editor-conformance",
          sourceKind: "owner",
        },
        {
          owner: "prompt:editor-conformance-alias",
          sourceKind: "owner",
        },
        {
          owner: "prompt:editor-conformance-namespace",
          sourceKind: "owner",
        },
      ]),
    );
    expect(
      promptTextRefs.some((sourceRef) =>
        sourceRef.ref.snippet?.source.includes("Not canonical"),
      ),
    ).toBe(false);

    const semantic = normalizeFixturePaths(
      {
        definitionId: owner.definitionId,
        sourceRef: owner.ref,
        diagnostics: canonicalDiagnostics(diagnostics),
      },
      file,
    );
    const fixture = parseFixture();
    if (process.env.CRUX_UPDATE_PROMPT_TEXT_CONFORMANCE !== undefined) {
      fixture.semantic = semantic;
      writeFileSync(fixtureUrl, `${JSON.stringify(fixture, null, 2)}\n`);
      return;
    }
    expect(fixture.semantic).toEqual(semantic);
  });
});

function canonicalDiagnostics(
  diagnostics: readonly IndexDiagnostic[],
): ReturnType<typeof projectPromptTextDiagnosticConclusions> {
  const conclusions = diagnostics.map(canonicalConclusion);
  return projectPromptTextDiagnosticConclusions(conclusions);
}

function canonicalConclusion(
  diagnostic: IndexDiagnostic,
): PromptTextDiagnosticConclusion {
  const evidence = PromptTextDiagnosticEvidenceSchema.parse(
    diagnostic.evidence,
  );
  const definitionId = diagnostic.relatedDefinitionIds?.[0];
  const source = diagnostic.source;
  if (
    definitionId === undefined ||
    diagnostic.relatedDefinitionIds?.length !== 1 ||
    source === undefined ||
    source.column === undefined
  ) {
    throw new Error("conformance diagnostic identity is incomplete");
  }
  const interpolation = {
    index: evidence.interpolationIndex,
    source: {
      file: canonicalFile,
      line: source.line,
      column: source.column,
    },
  };
  const base = {
    kind: "prompt-text-diagnostic" as const,
    definitionId,
    sourceRefId: evidence.sourceRefId,
    owner: {
      role: "prompt" as const,
      property: "prompt" as const,
      lifecycle: "static" as const,
    },
    proof: "semantic-exact" as const,
  };
  switch (evidence.cause.kind) {
    case "invalid-interpolation":
      return {
        ...base,
        interpolation: {
          ...interpolation,
          ...(evidence.interpolationPath === undefined
            ? {}
            : { path: evidence.interpolationPath }),
        },
        cause: evidence.cause,
      };
    case "inline-sequence":
      return { ...base, interpolation, cause: evidence.cause };
    case "json-serialization":
      return { ...base, interpolation, cause: evidence.cause };
  }
}

function parseFixture(): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  if (!isRecord(value)) {
    throw new Error("shared PromptText conformance fixture must be an object");
  }
  return value;
}

function normalizeFixturePaths(value: unknown, temporaryFile: string): unknown {
  if (typeof value === "string") {
    return value === temporaryFile ? canonicalFile : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFixturePaths(item, temporaryFile));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      normalizeFixturePaths(item, temporaryFile),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
