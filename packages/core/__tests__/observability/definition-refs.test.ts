import { describe, expect, it } from "vitest";
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CruxRunStartRecordSchema,
  CruxSpanRecordSchema,
  CruxSpanStartRecordSchema,
  DefinitionRefRoleSchema,
  DefinitionRefSchema,
  SanitizedSourceRefSchema,
  type DefinitionRef,
} from "../../src/observability";

const runStart = {
  schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
  recordId: "rec_1",
  operationId: "run_1",
  runId: "run_1",
  segmentId: "seg_1",
  segmentSeq: 1,
  type: "run:start" as const,
  name: "support.reply",
  rootPrimitive: "generation.call",
  startedAt: "2026-07-11T00:00:00.000Z",
  status: "running" as const,
};

const spanStart = {
  schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
  recordId: "rec_2",
  operationId: "run_1",
  runId: "run_1",
  segmentId: "seg_1",
  segmentSeq: 2,
  type: "span:start" as const,
  spanId: "841e9c04c4d09a6e",
  family: "generation",
  primitive: "generation.call",
  name: "generate",
  startedAt: "2026-07-11T00:00:00.000Z",
  status: "running" as const,
};

const spanRecord = {
  schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
  recordId: "rec_3",
  operationId: "run_1",
  runId: "run_1",
  segmentId: "seg_1",
  segmentSeq: 3,
  type: "span" as const,
  spanId: "841e9c04c4d09a6e",
  family: "generation",
  primitive: "generation.call",
  name: "generate",
  startedAt: "2026-07-11T00:00:00.000Z",
  status: "ok" as const,
};

const promptRef: DefinitionRef = {
  id: "support.reply",
  kind: "prompt",
  role: "resolved-prompt",
  source: { file: "src/prompts/support.ts", line: 12, column: 3 },
};

const toolRef: DefinitionRef = {
  id: "lookup-order",
  kind: "tool",
  role: "invoked-tool",
};

describe("DefinitionRef wire contract", () => {
  it("exposes exactly the currently-required roles as a closed union", () => {
    expect(DefinitionRefRoleSchema.options).toEqual([
      "resolved-prompt",
      "resolved-context",
      "resolved-mcp-server",
      "invoked-tool",
      "invoked-agent",
      "invoked-flow",
      "invoked-retriever",
      "invoked-composition",
      "invoked-blackboard",
      "invoked-routing",
      "loaded-skill",
      "invoked-guardrail",
      "invoked-constraint",
      "invoked-task",
      "invoked-workspace",
      "invoked-memory",
      "invoked-recipe",
      "invoked-reranker",
      "contributed-knowledge-base",
      "contributed-tool-policy",
      "invoked-flow-step",
      "invoked-composition-branch",
      "invoked-recipe-step",
      "invoked-scorer",
      "invoked-media-operation",
    ]);
  });

  it("accepts an exact authored media-operation identity without guessing one", () => {
    expect(
      DefinitionRefSchema.parse({
        id: "media.operation:hero-image",
        kind: "media.operation",
        role: "invoked-media-operation",
      }),
    ).toEqual({
      id: "media.operation:hero-image",
      kind: "media.operation",
      role: "invoked-media-operation",
    });
  });

  it("parses a single valid ref with a sanitized source", () => {
    const parsed = DefinitionRefSchema.parse(promptRef);
    expect(parsed).toEqual(promptRef);
  });

  it("parses a ref without an optional source", () => {
    expect(DefinitionRefSchema.parse(toolRef)).toEqual(toolRef);
  });

  it("accepts a sanitized source ref with only file and line", () => {
    expect(
      SanitizedSourceRefSchema.parse({ file: "src/a.ts", line: 4 }),
    ).toEqual({ file: "src/a.ts", line: 4 });
  });

  it("rejects an unknown role", () => {
    expect(
      DefinitionRefSchema.safeParse({ ...toolRef, role: "invoked-mystery" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown definition kind", () => {
    expect(
      DefinitionRefSchema.safeParse({ ...toolRef, kind: "not-a-real-kind" })
        .success,
    ).toBe(false);
  });

  it("accepts the full ProjectDefinitionKind vocabulary", () => {
    expect(
      DefinitionRefSchema.safeParse({
        id: "router",
        kind: "routing.router",
        role: "invoked-composition",
      }).success,
    ).toBe(true);
  });

  it("strips forbidden fingerprint/projectRevision fields", () => {
    const parsed = DefinitionRefSchema.parse({
      ...toolRef,
      fingerprint: "deadbeef",
      projectRevision: 42,
    });
    expect(parsed).not.toHaveProperty("fingerprint");
    expect(parsed).not.toHaveProperty("projectRevision");
    expect(parsed).toEqual(toolRef);
  });

  describe.each([
    ["run:start", CruxRunStartRecordSchema, runStart],
    ["span:start", CruxSpanStartRecordSchema, spanStart],
    ["span", CruxSpanRecordSchema, spanRecord],
  ] as const)("%s carries optional definitionRefs", (_label, schema, base) => {
    it("parses without definitionRefs", () => {
      const parsed = schema.parse(base);
      expect(parsed).not.toHaveProperty("definitionRefs");
    });

    it("parses with a single ref", () => {
      const parsed = schema.parse({ ...base, definitionRefs: [promptRef] });
      expect(parsed.definitionRefs).toEqual([promptRef]);
    });

    it("parses with multiple refs", () => {
      const parsed = schema.parse({
        ...base,
        definitionRefs: [promptRef, toolRef],
      });
      expect(parsed.definitionRefs).toHaveLength(2);
    });

    it("rejects a ref with an invalid role", () => {
      expect(
        schema.safeParse({
          ...base,
          definitionRefs: [{ ...toolRef, role: "bogus" }],
        }).success,
      ).toBe(false);
    });
  });
});
