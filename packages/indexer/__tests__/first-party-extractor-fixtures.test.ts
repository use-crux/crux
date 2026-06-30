import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { cruxCoreExtension } from "../indexer/extractors/crux-core-extension";
import "./first-party-phase5-native-fixtures";
import "./first-party-phase6-agent-native-fixtures";
import "./first-party-phase6-native-fixtures";
import "./first-party-phase7-composition-native-fixtures";
import "./first-party-phase7-flow-native-fixtures";
import "./first-party-phase7-native-fixtures";
import {
  firstPartyStaticIndexNodeOwnershipAudit,
  firstPartyPrimitiveFixtureInventory,
} from "./first-party-extractor-inventory";
import {
  assertDeterministicExtraction,
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from "../testing";

const cruxFixture = defineIndexerExtensionFixture(cruxCoreExtension);

describe("first-party extractor fixtures", () => {
  it("records the first-party primitive fixture inventory", () => {
    const inventory = firstPartyPrimitiveFixtureInventory();

    expect(inventory).toEqual([
      {
        extractor: "rag.retriever",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "safety",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "scorer",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "storage",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "workspace",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "eval",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "skill-registry",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "registry-skill",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "tool",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "injectable",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "context",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "prompt",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "agent",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "composition",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "memory",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "blackboard",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "routing",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
      {
        extractor: "flow",
        fixtureCoverage: "dedicated-fixture",
        staticIndexCoverage: "covered",
      },
    ]);
    expect(
      inventory
        .filter((item) => item.fixtureCoverage === "missing-fixture")
        .map((item) => item.extractor),
    ).toEqual([]);
  });

  it("records first-party host eligibility and remaining Go-owned Node reasons", () => {
    expect(firstPartyStaticIndexNodeOwnershipAudit()).toEqual({
      nativeOnlyEligible: true,
      nodeStartsBecause: [
        "Go asks Node to inspect the static syntax plan before Rust/Oxc parses files.",
      ],
      bundledNativeExtractors: [
        "rag.retriever",
        "safety",
        "scorer",
        "storage",
        "workspace",
        "eval",
        "skill-registry",
        "registry-skill",
        "tool",
        "injectable",
        "context",
        "prompt",
        "agent",
        "composition",
        "memory",
        "blackboard",
        "routing",
        "flow",
      ],
      bundledTypeScriptExtractors: [],
      typeScriptRuleCount: 0,
    });
  });

  it("extracts prompt and context facts through the public fixture engine", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const brandContext = context({
          id: 'brand-context',
          system: 'Use the brand voice.',
        })

        export const writerPrompt = prompt({
          id: 'writer',
          use: [brandContext],
          system: 'Write in the requested style.',
          prompt: () => 'Draft copy',
        })
      `,
    );

    expect(definition(out.definitions, "context:brand-context")).toMatchObject({
      kind: "context",
      name: "brand-context",
      metadata: expect.objectContaining({
        exportName: "brandContext",
        isStatic: true,
        facts: expect.objectContaining({
          kind: "context",
          isStatic: true,
        }),
      }),
    });
    expect(definition(out.definitions, "prompt:writer")).toMatchObject({
      kind: "prompt",
      name: "writer",
      metadata: expect.objectContaining({
        exportName: "writerPrompt",
        facts: expect.objectContaining({
          kind: "prompt",
          hasSystem: true,
          hasPrompt: true,
          useEntries: expect.arrayContaining([
            expect.objectContaining({ variable: "brandContext" }),
          ]),
        }),
      }),
    });
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "prompt.uses_context",
          from: "prompt:writer",
          to: "context:brand-context",
        }),
      ]),
    );
    await expect(
      assertDeterministicExtraction(
        cruxFixture,
        `export const writerPrompt = prompt({ id: 'writer', prompt: 'Draft copy' })`,
      ),
    ).resolves.toBeUndefined();
  });

  it("extracts tool schemas and execution metadata without parser-native test contexts", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search documentation',
          parameters: {
            query: 'string',
          },
          execute: async () => 'result',
        })
      `,
    );

    expect(definition(out.definitions, "tool:searchDocs")).toMatchObject({
      kind: "tool",
      name: "searchDocs",
      metadata: expect.objectContaining({
        exportName: "searchDocs",
        hasExecute: true,
        facts: expect.objectContaining({
          kind: "tool",
          toolName: "searchDocs",
          hasExecute: true,
        }),
      }),
    });
  });

  it("extracts agent prompt and tool relations from source text", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search documentation',
          parameters: { query: 'string' },
          execute: async () => 'result',
        })

        export const writerAgent = agent({
          id: 'writer-agent',
          prompt: writerPrompt,
          tools: [searchDocs],
        })
      `,
    );

    expect(definition(out.definitions, "agent:writer-agent")).toMatchObject({
      kind: "agent",
      name: "writer-agent",
      metadata: expect.objectContaining({
        exportName: "writerAgent",
        facts: expect.objectContaining({
          kind: "agent",
          promptId: "writerPrompt",
          toolNames: ["searchDocs"],
        }),
      }),
    });
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agent.uses_prompt",
          from: "agent:writer-agent",
          to: "prompt:writer",
        }),
        expect.objectContaining({
          type: "agent.uses_tool",
          from: "agent:writer-agent",
          to: "tool:searchDocs",
        }),
      ]),
    );
  });

  it("extracts workspace operator config and generated tool posture", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        const searchDocs = createTool({ name: 'searchDocs' })

        export const scratch = workspace({
          id: 'scratch',
          namespace: 'tenant-a',
          mounts: [{ path: '/workspace', access: 'readwrite', description: 'Working files' }],
          tools: { prefix: 'research', delete: true, searchDocs },
          limits: { maxFileBytes: 1000, maxNamespaceBytes: 5000 },
          retention: { ttlMs: 60000 },
          storage: blobStore,
        })

        export const writer = tool({
          name: 'writer',
          execute: async () => {
            await scratch.exists('/workspace/a.md')
            await scratch.stat('/workspace/a.md')
            await scratch.grep('alpha')
            await scratch.artifacts({ status: 'final' })
            await scratch.rename('/workspace/a.md', '/workspace/b.md')
            await scratch.move('/workspace/b.md', '/workspace/c.md')
            await scratch.copy('/workspace/c.md', '/outputs/report-copy.md')
            await scratch.finalize('/outputs/report.md')
            return 'done'
          },
        })
      `,
    );

    expect(definition(out.definitions, "workspace:scratch")?.metadata).toEqual(
      expect.objectContaining({
        namespace: "tenant-a",
        hasBlobStorage: true,
        hasTools: true,
        toolRefs: ["searchDocs"],
        tools: expect.objectContaining({
          prefix: "research",
          delete: true,
          generated: expect.objectContaining({
            list: "listResearchWorkspace",
            readFile: "readResearchWorkspaceFile",
            writeFile: "writeResearchWorkspaceFile",
            editFile: "editResearchWorkspaceFile",
            renameFile: "renameResearchWorkspaceFile",
            grep: "grepResearchWorkspace",
            deleteFile: "deleteResearchWorkspaceFile",
          }),
        }),
        limits: { maxFileBytes: 1000, maxNamespaceBytes: 5000 },
        retention: { ttlMs: 60000 },
        mounts: [
          expect.objectContaining({ path: "/workspace", access: "readwrite" }),
        ],
        intelligence: expect.objectContaining({
          confidence: "static",
          tools: ["searchDocs"],
          operator: expect.objectContaining({
            retention: { ttlMs: 60000 },
            limits: { maxFileBytes: 1000, maxNamespaceBytes: 5000 },
          }),
        }),
      }),
    );
    expect(
      definition(out.definitions, "tool:writer")?.metadata?.intelligence,
    ).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          reads: expect.arrayContaining([
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "grep",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "artifacts",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "exists",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "stat",
            }),
          ]),
          writes: expect.arrayContaining([
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "rename",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "move",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "copy",
            }),
            expect.objectContaining({
              targetVariable: "scratch",
              operation: "finalize",
            }),
          ]),
        }),
      }),
    );
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.reads_workspace",
          from: "tool:writer",
          to: "workspace:scratch",
        }),
        expect.objectContaining({
          type: "tool.writes_workspace",
          from: "tool:writer",
          to: "workspace:scratch",
        }),
      ]),
    );
  });

  it("extracts Storage Beta definitions, wiring, and primitive dependencies", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        import {
          inMemoryBlobStore,
          inMemoryRecordStore,
          inMemoryVectorStore,
          storage,
        } from '@use-crux/core/storage'
        import { retriever, workspace } from '@use-crux/core'

        export const records = inMemoryRecordStore()
        export const vectors = inMemoryVectorStore()
        export const blobs = inMemoryBlobStore()
        export const appStorage = storage({ records, vectors, blobs })
        export const literalStorage = { records, vectors, blobs }
        export const tenantStorage = storage.scope(appStorage, 'tenant-a')

        export const docsRetriever = retriever({
          id: 'docs',
          storage: appStorage,
          records,
          vectors,
        })

        export const scratch = workspace({
          id: 'scratch',
          storage: tenantStorage,
          records,
          blobs,
        })
      `,
    );

    expect(definition(out.definitions, "storage.recordStore:records")).toMatchObject({
      kind: "storage.recordStore",
      name: "records",
      metadata: expect.objectContaining({
        exportName: "records",
        backend: "inMemoryRecordStore",
        facts: expect.objectContaining({
          kind: "storage.recordStore",
          backend: "inMemoryRecordStore",
          capabilities: expect.objectContaining({
            record: expect.objectContaining({
              ttl: "lazy",
              filter: "scan",
              watch: true,
              batch: false,
            }),
          }),
        }),
      }),
    });
    expect(definition(out.definitions, "storage.vectorStore:vectors")).toMatchObject({
      kind: "storage.vectorStore",
      name: "vectors",
      metadata: expect.objectContaining({
        backend: "inMemoryVectorStore",
        facts: expect.objectContaining({
          kind: "storage.vectorStore",
          capabilities: expect.objectContaining({
            vector: expect.objectContaining({
              dense: true,
              sparse: true,
              hybrid: true,
              fusion: [],
              filter: "pre",
              consistency: "strong",
            }),
          }),
        }),
      }),
    });
    expect(definition(out.definitions, "storage.blobStore:blobs")).toMatchObject({
      kind: "storage.blobStore",
      name: "blobs",
      metadata: expect.objectContaining({
        backend: "inMemoryBlobStore",
        facts: expect.objectContaining({
          kind: "storage.blobStore",
          capabilities: expect.objectContaining({
            blob: expect.objectContaining({
              multipart: false,
              signedUrls: false,
            }),
          }),
        }),
      }),
    });
    expect(definition(out.definitions, "storage.bundle:appStorage")).toMatchObject({
      kind: "storage.bundle",
      name: "appStorage",
      metadata: expect.objectContaining({
        recordsVariable: "records",
        vectorsVariable: "vectors",
        blobsVariable: "blobs",
        facts: expect.objectContaining({
          kind: "storage.bundle",
          records: "records",
          vectors: "vectors",
          blobs: "blobs",
        }),
        intelligence: expect.objectContaining({
          dependencies: expect.objectContaining({
            recordStores: ["records"],
            vectorStores: ["vectors"],
            blobStores: ["blobs"],
          }),
        }),
      }),
    });
    expect(definition(out.definitions, "storage.bundle:literalStorage")).toMatchObject({
      kind: "storage.bundle",
      name: "literalStorage",
      metadata: expect.objectContaining({
        recordsVariable: "records",
        vectorsVariable: "vectors",
        blobsVariable: "blobs",
      }),
    });
    expect(definition(out.definitions, "storage.scope:tenantStorage")).toMatchObject({
      kind: "storage.scope",
      name: "tenantStorage",
      metadata: expect.objectContaining({
        baseStorageVariable: "appStorage",
        prefix: "tenant-a",
        facts: expect.objectContaining({
          kind: "storage.scope",
          storage: "appStorage",
          prefix: "tenant-a",
        }),
      }),
    });
    expect(definition(out.definitions, "rag.retriever:docs")?.metadata?.intelligence).toEqual(
      expect.objectContaining({
        dependencies: expect.objectContaining({
          storage: ["appStorage"],
          recordStores: ["records"],
          vectorStores: ["vectors"],
        }),
      }),
    );
    expect(definition(out.definitions, "workspace:scratch")?.metadata?.intelligence).toEqual(
      expect.objectContaining({
        dependencies: expect.objectContaining({
          storage: ["tenantStorage"],
          recordStores: ["records"],
          blobStores: ["blobs"],
        }),
      }),
    );
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "storage.bundle.uses_record_store",
          from: "storage.bundle:appStorage",
          to: "storage.recordStore:records",
        }),
        expect.objectContaining({
          type: "storage.bundle.uses_vector_store",
          from: "storage.bundle:appStorage",
          to: "storage.vectorStore:vectors",
        }),
        expect.objectContaining({
          type: "storage.bundle.uses_blob_store",
          from: "storage.bundle:appStorage",
          to: "storage.blobStore:blobs",
        }),
        expect.objectContaining({
          type: "storage.scope.wraps_storage",
          from: "storage.scope:tenantStorage",
          to: "storage.bundle:appStorage",
        }),
        expect.objectContaining({
          type: "rag.retriever.uses_storage",
          from: "rag.retriever:docs",
          to: "storage.bundle:appStorage",
        }),
        expect.objectContaining({
          type: "workspace.uses_storage",
          from: "workspace:scratch",
          to: "storage.scope:tenantStorage",
        }),
      ]),
    );
    expect(out.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("storage."))).toEqual([]);
  });

  it("extracts routing routers as folded child graphs", async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })

        export const qualityRouter = router({
          id: 'quality-router',
          routes: {
            default: writerPrompt,
          },
          classify: () => 'default',
        })
      `,
    );

    expect(
      definition(out.definitions, "routing.router:quality-router"),
    ).toMatchObject({
      kind: "routing.router",
      name: "quality-router",
      metadata: expect.objectContaining({
        exportName: "qualityRouter",
        routeKeys: ["default"],
        routeCount: 1,
        hasDefaultRoute: true,
        hasClassify: true,
      }),
    });
    expect(
      definition(
        out.definitions,
        "routing.router:quality-router:route:default",
      ),
    ).toMatchObject({
      kind: "routing.router.route",
      name: "default",
      metadata: expect.objectContaining({
        routerDefinitionId: "routing.router:quality-router",
        routeKey: "default",
        targetVariable: "writerPrompt",
      }),
    });
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "router.includes_route",
          from: "routing.router:quality-router",
          to: "routing.router:quality-router:route:default",
        }),
        expect.objectContaining({
          type: "router.route.uses_prompt",
          from: "routing.router:quality-router:route:default",
          to: "prompt:writer",
        }),
      ]),
    );
  });
});

function definition(
  definitions: readonly ProjectDefinition[],
  id: string,
): ProjectDefinition | undefined {
  return definitions.find((item) => item.id === id);
}
