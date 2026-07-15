import { describe, expect, it } from "vitest";
import {
  CruxDeploymentIdentitySchema,
  ProjectIndexDeploymentManifestV1Schema,
  ProjectIndexManifestSourceSchema,
  ProjectIndexManifestSourceRefSchema,
} from "@use-crux/core/project-index";

describe("Project Index deployment manifest schemas", () => {
  it("accepts the empty v1 manifest and a fully specified deployment identity", () => {
    expect(
      CruxDeploymentIdentitySchema.parse({
        projectId: "crux-docs",
        manifestId:
          "pim_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deploymentId: "deploy_2026-07-14",
      }),
    ).toEqual({
      projectId: "crux-docs",
      manifestId:
        "pim_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      deploymentId: "deploy_2026-07-14",
    });

    expect(
      ProjectIndexDeploymentManifestV1Schema.parse({
        schemaVersion: 1,
        projectId: "crux-docs",
        manifestId:
          "pim_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        content: { schemaVersion: 1, definitions: [], relations: [] },
        provenance: {
          producer: "@use-crux/indexer",
          producerVersion: "0.5.0",
          staticFrontend: "oxc",
          semanticStatus: "disabled",
        },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      projectId: "crux-docs",
      content: { definitions: [], relations: [] },
    });
  });

  it.each([
    ["empty project", { projectId: "" }],
    ["untrimmed project", { projectId: " crux" }],
    ["control character", { projectId: "crux\nsecret" }],
    ["oversized UTF-8 project", { projectId: "é".repeat(101) }],
    [
      "uppercase manifest hash",
      { projectId: "crux", manifestId: `pim_${"A".repeat(64)}` },
    ],
    ["short manifest hash", { projectId: "crux", manifestId: "pim_deadbeef" }],
    ["empty deployment", { projectId: "crux", deploymentId: "" }],
  ])("rejects malformed identity: %s", (_label, identity) => {
    expect(() => CruxDeploymentIdentitySchema.parse(identity)).toThrow();
  });

  it("rejects unknown envelope fields instead of silently retaining secrets", () => {
    const manifest = {
      schemaVersion: 1,
      projectId: "crux-docs",
      manifestId:
        "pim_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      content: {
        schemaVersion: 1,
        definitions: [],
        relations: [],
        promptSecret: "do-not-serialize",
      },
      provenance: {
        producer: "@use-crux/indexer",
        producerVersion: "0.5.0",
        staticFrontend: "oxc",
        semanticStatus: "complete",
      },
    };

    expect(() =>
      ProjectIndexDeploymentManifestV1Schema.parse(manifest),
    ).toThrow();
  });

  it("uses ECMAScript trim semantics for Unicode identity boundaries", () => {
    expect(
      CruxDeploymentIdentitySchema.safeParse({ projectId: "\u0085crux\u0085" })
        .success,
    ).toBe(true);
    expect(
      CruxDeploymentIdentitySchema.safeParse({ projectId: "\ufeffcrux\ufeff" })
        .success,
    ).toBe(false);
  });

  it.each([
    "/repo/src/prompt.ts",
    "C:/repo/src/prompt.ts",
    "C:repo/src/prompt.ts",
    "src\\prompt.ts",
    "../prompt.ts",
    "src/../prompt.ts",
    "src/./prompt.ts",
    "src//prompt.ts",
    ".",
  ])("rejects a non-canonical manifest source path: %s", (file) => {
    expect(() =>
      ProjectIndexManifestSourceSchema.parse({ file, line: 1 }),
    ).toThrow();
  });

  it("rejects empty optional source-ref identifiers", () => {
    expect(() =>
      ProjectIndexManifestSourceRefSchema.parse({
        id: "prompt:writer:schema",
        role: "schema",
        property: "",
        source: { file: "src/schema.ts", line: 1 },
        fidelity: "resolved",
      }),
    ).toThrow();
  });
});
