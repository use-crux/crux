import { describe, expect, it } from "vitest";
import type {
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import { createProjectIndexDeploymentManifest } from "../src/indexer/deployment-manifest";

describe("Project Index deployment manifest privacy", () => {
  it("projects only allowlisted fields and drops unsafe optional source data", () => {
    const definitions: ProjectDefinition[] = [
      {
        id: "prompt:safe",
        kind: "prompt",
        name: "Safe prompt",
        description: "PROMPT_DESCRIPTION_SECRET",
        tags: ["TAG_SECRET"],
        source: {
          file: "/repo/src/./prompt.ts",
          line: 4,
          function: "secretCallback",
        },
        sourceSnippet: {
          source: "PROMPT_BODY_SECRET",
          range: { file: "/repo/src/prompt.ts", startLine: 4 },
        },
        sourceRefs: [
          {
            id: "prompt:safe:valid",
            role: "schema",
            property: "input\nSECRET_PROPERTY",
            symbol: "S".repeat(201),
            source: { file: "/repo/src/schema.ts", line: 8 },
            snippet: {
              source: "SOURCE_REF_SECRET",
              range: { file: "/repo/src/schema.ts", startLine: 8 },
            },
            fidelity: "resolved",
            description: "SOURCE_REF_DESCRIPTION_SECRET",
            metadata: { extensions: { token: "SOURCE_REF_METADATA_SECRET" } },
          },
          {
            id: "prompt:safe:outside",
            role: "callback",
            source: { file: "/private/user/callback.ts", line: 2 },
            fidelity: "partial",
          },
          {
            id: "prompt:safe:traversal",
            role: "helper",
            source: { file: "../credentials.ts", line: 1 },
            fidelity: "partial",
          },
          {
            id: "prompt:safe:drive-relative",
            role: "helper",
            source: { file: "C:private/credentials.ts", line: 1 },
            fidelity: "partial",
          },
        ],
        fidelity: "resolved",
        fingerprint: "definition-fingerprint",
        metadata: {
          configuration: { apiKey: "sk-METADATA_SECRET" },
          settings: { password: "PASSWORD_SECRET" },
        },
      },
      {
        id: "context:missing",
        kind: "context",
        name: "Missing secret context",
        fidelity: "error",
        status: "missing",
      },
      {
        id: "tool:stale",
        kind: "tool",
        name: "Stale secret tool",
        fidelity: "partial",
        status: "stale",
      },
    ];
    const relations: ProjectRelation[] = [
      {
        id: "resolved-malformed",
        type: "uses",
        from: "prompt:safe",
        to: "context:missing",
        fidelity: "resolved",
        metadata: { secret: "RELATION_METADATA_SECRET" },
      },
      {
        id: "partial-external",
        type: "uses",
        from: "prompt:safe",
        to: "external:unknown",
        fidelity: "partial",
      },
    ];

    const result = createProjectIndexDeploymentManifest({
      projectId: "privacy-project",
      projectRoot: "/repo",
      definitions,
      relations,
      provenance: {
        producerVersion: "0.5.0",
        staticFrontend: "oxc",
        semanticStatus: "partial",
      },
    });
    const serialized = JSON.stringify(result.manifest);

    expect(result.manifest.content.definitions).toEqual([
      {
        id: "prompt:safe",
        kind: "prompt",
        name: "Safe prompt",
        fidelity: "resolved",
        source: { file: "src/prompt.ts", line: 4 },
        sourceRefs: [
          {
            id: "prompt:safe:valid",
            role: "schema",
            source: { file: "src/schema.ts", line: 8 },
            fidelity: "resolved",
          },
        ],
        fingerprints: { definition: "definition-fingerprint" },
      },
    ]);
    expect(result.manifest.content.relations).toEqual([
      expect.objectContaining({ id: "partial-external", fidelity: "partial" }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "manifest.relation-endpoint-missing",
        relatedDefinitionIds: ["prompt:safe", "context:missing"],
      }),
    ]);
    for (const secret of [
      "/repo",
      "/private",
      "..",
      "PROMPT_",
      "TAG_SECRET",
      "SOURCE_REF_",
      "METADATA_SECRET",
      "PASSWORD_SECRET",
      "RELATION_METADATA_SECRET",
      "secretCallback",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
