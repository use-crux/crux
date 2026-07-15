import type {
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import type { CreateProjectIndexDeploymentManifestInput } from "../../../src/indexer/deployment-manifest";

export const deploymentManifestDefinitions = [
  {
    id: "prompt:writer",
    kind: "prompt",
    name: "Writer",
    fidelity: "resolved",
    status: "active",
    source: { file: "/workspace/project/src/writer.ts", line: 4, column: 2 },
    sourceRefs: [
      {
        id: "prompt:writer:schema",
        role: "schema",
        symbol: "WriterInput",
        source: { file: "/workspace/project/src/schema.ts", line: 2 },
        fidelity: "resolved",
      },
    ],
    fingerprint: "def_writer_v1",
    metadata: {
      intelligence: {
        confidence: "semantic",
        contract: {
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: { query: { type: "string" } },
          },
          requiredFields: ["query"],
        },
      },
    },
  },
  {
    id: "context:資料",
    kind: "context",
    name: "資料",
    fidelity: "partial",
    source: { file: "/workspace/project/src/context.ts", line: 3 },
  },
] satisfies readonly ProjectDefinition[];

export const deploymentManifestRelations = [
  {
    id: "prompt:writer:uses:context:資料",
    type: "uses",
    from: "prompt:writer",
    to: "context:資料",
    fidelity: "resolved",
    source: { file: "/workspace/project/src/writer.ts", line: 5 },
  },
] satisfies readonly ProjectRelation[];

export const deploymentManifestInput = {
  projectId: "manifest-fixture",
  projectRoot: "/workspace/project",
  definitions: deploymentManifestDefinitions,
  relations: deploymentManifestRelations,
  provenance: {
    producerVersion: "0.5.0",
    staticFrontend: "oxc",
    semanticBackend: "typescript",
    semanticStatus: "complete",
  },
} satisfies CreateProjectIndexDeploymentManifestInput;
