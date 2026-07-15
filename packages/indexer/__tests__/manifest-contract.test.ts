import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  ContractFacts,
  PrimitiveIntelligence,
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import { ProjectIndexDeploymentManifestV1Schema } from "@use-crux/core/project-index";
import { createProjectIndexDeploymentManifest } from "../src/indexer/deployment-manifest";
import { deploymentManifestInput } from "./fixtures/deployment-manifest-project/fixture";

describe("Project Index deployment manifest contract", () => {
  it("matches the shared TypeScript and Go golden artifact", async () => {
    const goldenPath = new URL(
      "./fixtures/deployment-manifest-project/manifest.golden.json",
      import.meta.url,
    );
    const golden = ProjectIndexDeploymentManifestV1Schema.parse(
      JSON.parse(await readFile(goldenPath, "utf8")),
    );
    const result = createProjectIndexDeploymentManifest(
      deploymentManifestInput,
    );

    expect(result.manifest).toEqual(golden);
    expect(result.manifest.manifestId).toBe(
      "pim_2ef1edd97de11a9af98749673d3e44fb90e28bc8ae61df42d6b7ba26dbc52329",
    );
  });

  it("pins canonical bytes and identity for an empty Catalog", () => {
    const first = createProjectIndexDeploymentManifest({
      projectId: "empty-project",
      projectRoot: "/workspace/empty",
      definitions: [],
      relations: [],
      provenance: {
        producerVersion: "0.5.0",
        staticFrontend: "oxc",
        semanticStatus: "disabled",
      },
    });
    const upgraded = createProjectIndexDeploymentManifest({
      projectId: "empty-project",
      projectRoot: "/different/checkout",
      definitions: [],
      relations: [],
      provenance: {
        producerVersion: "9.0.0",
        staticFrontend: "typescript",
        semanticBackend: "tsgo",
        semanticStatus: "complete",
      },
    });

    expect(first.canonicalContent).toBe(
      '{"definitions":[],"relations":[],"schemaVersion":1}',
    );
    expect(first.manifest.manifestId).toBe(
      "pim_7f4880a3a03ab206dcbc6fd0f423c603f29f938915fbb324f7c580e9fc25dd0e",
    );
    expect(first.manifest.manifestId).toBe(upgraded.manifest.manifestId);
    expect(first.diagnostics).toEqual([]);
  });

  it("normalizes input order, checkout roots, path separators, and non-ASCII identities", () => {
    const posixDefinitions = manifestDefinitions("/home/ci/checkout", "/");
    const windowsDefinitions = manifestDefinitions("C:\\work\\checkout", "\\");
    const relations = manifestRelations();

    const posix = createProjectIndexDeploymentManifest({
      projectId: "international-project",
      projectRoot: "/home/ci/checkout",
      definitions: [...posixDefinitions].reverse(),
      relations: [...relations].reverse(),
      provenance: provenance("0.5.0"),
    });
    const windows = createProjectIndexDeploymentManifest({
      projectId: "international-project",
      projectRoot: "C:\\work\\checkout",
      definitions: windowsDefinitions,
      relations,
      provenance: provenance("7.0.0"),
    });

    expect(posix.canonicalContent).toBe(windows.canonicalContent);
    expect(posix.manifest.manifestId).toBe(windows.manifest.manifestId);
    expect(posix.manifest.content.definitions.map(({ id }) => id)).toEqual([
      "context:資料",
      "prompt:café-😀",
    ]);
    expect(posix.manifest.content.definitions[1]?.source?.file).toBe(
      "src/prompt.ts",
    );
    expect(posix.manifest.provenance.producerVersion).not.toBe(
      windows.manifest.provenance.producerVersion,
    );
  });

  it("changes manifest identity when relation semantics change", () => {
    const definitions = manifestDefinitions("/repo", "/");
    const first = createProjectIndexDeploymentManifest({
      projectId: "relation-project",
      projectRoot: "/repo",
      definitions,
      relations: manifestRelations(),
      provenance: provenance("0.5.0"),
    });
    const changed = createProjectIndexDeploymentManifest({
      projectId: "relation-project",
      projectRoot: "/repo",
      definitions,
      relations: manifestRelations().map((relation) => ({
        ...relation,
        type: "depends-on",
      })),
      provenance: provenance("0.5.0"),
    });

    expect(first.manifest.manifestId).not.toBe(changed.manifest.manifestId);
  });

  it("fingerprints canonical contract facts and changes manifest identity with them", () => {
    const first = manifestWithContractFacts({
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" } },
      },
      requiredFields: ["query"],
    });
    const changed = manifestWithContractFacts({
      inputSchema: {
        type: "object",
        required: ["topic"],
        properties: { topic: { type: "string" } },
      },
      requiredFields: ["topic"],
    });

    expect(first.manifest.content.definitions[1]?.fingerprints?.contract).toBe(
      "41bcbd0a7fba50e420fbbd0a435d9f754adb0b6bf94b0c874b6dd8ac9c8bf508",
    );
    expect(
      first.manifest.content.definitions[1]?.fingerprints?.contract,
    ).not.toBe(changed.manifest.content.definitions[1]?.fingerprints?.contract);
    expect(first.manifest.manifestId).not.toBe(changed.manifest.manifestId);
  });

  it("excludes sibling intelligence fields from contract and manifest identity", () => {
    const contract: ContractFacts = {
      requiredFields: ["query"],
      inputSchema: {
        properties: { query: { type: "string" } },
        type: "object",
        required: ["query"],
      },
    };
    const first = manifestWithContractFacts(contract, {
      confidence: "static",
    });
    const changed = manifestWithContractFacts(contract, {
      confidence: "runtime",
      control: { mode: "parallel", children: ["SECRET_SIBLING"] },
      extensions: { token: "SECRET_EXTENSION" },
    });

    expect(first.canonicalContent).toBe(changed.canonicalContent);
    expect(first.manifest.manifestId).toBe(changed.manifest.manifestId);
    expect(JSON.stringify(first.manifest)).not.toContain("SECRET_");
  });
});

function manifestWithContractFacts(
  contract: ContractFacts,
  intelligence: Omit<PrimitiveIntelligence, "contract"> = {
    confidence: "semantic",
  },
) {
  const definitions = manifestDefinitions("/repo", "/").map((definition) =>
    definition.id === "prompt:café-😀"
      ? {
          ...definition,
          metadata: {
            intelligence: { ...intelligence, contract },
          },
        }
      : definition,
  );
  return createProjectIndexDeploymentManifest({
    projectId: "contract-project",
    projectRoot: "/repo",
    definitions,
    relations: manifestRelations(),
    provenance: provenance("0.5.0"),
  });
}

function manifestDefinitions(root: string, separator: "/" | "\\") {
  const file = (...segments: string[]) => [root, ...segments].join(separator);
  return [
    {
      id: "prompt:café-😀",
      kind: "prompt",
      name: "Café 😀",
      fidelity: "resolved",
      source: { file: file("src", "prompt.ts"), line: 4, column: 2 },
      sourceRefs: [
        {
          id: "prompt:café-😀:schema",
          role: "schema",
          symbol: "Entrée",
          source: { file: file("src", "schema.ts"), line: 8 },
          fidelity: "resolved",
        },
      ],
      fingerprint: "definition-prompt",
    },
    {
      id: "context:資料",
      kind: "context",
      name: "資料",
      fidelity: "partial",
      source: { file: file("src", "context.ts"), line: 3 },
    },
  ] satisfies ProjectDefinition[];
}

function manifestRelations() {
  return [
    {
      id: "prompt:context",
      type: "uses",
      from: "prompt:café-😀",
      to: "context:資料",
      fidelity: "resolved",
    },
  ] satisfies ProjectRelation[];
}

function provenance(producerVersion: string) {
  return {
    producerVersion,
    staticFrontend: "oxc",
    semanticBackend: "typescript",
    semanticStatus: "complete" as const,
  };
}
