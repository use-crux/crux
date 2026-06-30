import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

describe("first-party Phase 5 native fixtures", () => {
  itWithRustOxc(
    "emits exact native workspace facts from Rust/Oxc records",
    async () => {
      const source = [
        "const docsRetriever = retriever({ id: 'docs', retrieve: async () => [] })",
        "const searchDocs = createTool({ name: 'searchDocs' })",
        "const customLoader = () => ({ kind: 'custom', read: async () => null })",
        "",
        "export const scratch = workspace({",
        "  id: 'scratch',",
        "  namespace: 'tenant-a',",
        "  tools: { searchDocs },",
        "  mounts: [",
        "    {",
        "      path: '/workspace',",
        "      access: 'write',",
        "      description: 'Draft files',",
        "      source: {",
        "        kind: 'custom',",
        "        list: async () => ({ entries: [] }),",
        "        read: async () => null,",
        "        write: async () => null,",
        "      },",
        "    },",
        "    { path: '/docs', access: 'read', source: { kind: 'retriever', retriever: docsRetriever } },",
        "    { path: '/guide', access: 'read', source: retrieverWorkspaceMountSource(docsRetriever, { query: 'guide' }) },",
        "    { path: '/catalog', access: 'read', source: customLoader() },",
        "  ],",
        "  storage: blobStore,",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["workspace"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(1);
      expect(record.nativeFacts?.[0]?.replaces).toEqual([
        { extension: "@use-crux/indexer/crux-core", extractor: "workspace" },
      ]);
      const workspaceMetadata = nativeOut.definitions.find(
        (definition) => definition.id === "workspace:scratch",
      )?.metadata;
      expect(workspaceMetadata?.mounts).toEqual([
        expect.objectContaining({
          path: "/workspace",
          source: expect.objectContaining({
            kind: "custom",
            capabilities: ["list", "read", "write"],
          }),
        }),
        expect.objectContaining({
          path: "/docs",
          source: expect.objectContaining({
            kind: "retriever",
            retriever: "docsRetriever",
          }),
        }),
        expect.objectContaining({
          path: "/guide",
          source: expect.objectContaining({
            kind: "retriever",
            helper: "retrieverWorkspaceMountSource",
          }),
        }),
        expect.objectContaining({
          path: "/catalog",
          source: expect.objectContaining({
            kind: "custom",
            helper: "customLoader",
          }),
        }),
      ]);
      expect(workspaceMetadata?.intelligence).toEqual(
        expect.objectContaining({
          confidence: "static",
          tools: ["searchDocs"],
          data: {
            mounts: [
              expect.objectContaining({
                path: "/workspace",
                sourceKind: "custom",
                sourceCapabilities: ["list", "read", "write"],
              }),
              expect.objectContaining({
                path: "/docs",
                sourceKind: "retriever",
                sourceRetriever: "docsRetriever",
              }),
              expect.objectContaining({
                path: "/guide",
                sourceKind: "retriever",
                sourceHelper: "retrieverWorkspaceMountSource",
              }),
              expect.objectContaining({
                path: "/catalog",
                sourceKind: "custom",
                sourceHelper: "customLoader",
              }),
            ],
            artifacts: [
              expect.objectContaining({
                name: "/workspace",
                kind: "write",
                sourceKind: "custom",
              }),
              expect.objectContaining({
                name: "/docs",
                kind: "read",
                sourceKind: "retriever",
              }),
              expect.objectContaining({
                name: "/guide",
                kind: "read",
                sourceKind: "retriever",
                sourceHelper: "retrieverWorkspaceMountSource",
              }),
              expect.objectContaining({
                name: "/catalog",
                kind: "read",
                sourceKind: "custom",
                sourceHelper: "customLoader",
              }),
            ],
          },
        }),
      );
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    60_000,
  );

  itWithRustOxc(
    "matches workspace tool-only intelligence metadata",
    async () => {
      const source = [
        "const searchDocs = createTool({ name: 'searchDocs' })",
        "",
        "export const scratchPad = workspace({",
        "  tools: { searchDocs },",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["workspace"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(1);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "matches workspace versioning data access methods in native primitive facts",
    async () => {
      const source = [
        "export const scratch = workspace({ id: 'scratch' })",
        "",
        "export const writer = tool({",
        "  name: 'writer',",
        "  execute: async () => {",
        "    await scratch.grep('alpha')",
        "    await scratch.artifacts({ status: 'final' })",
        "    await scratch.stat('/workspace/a.md')",
        "    await scratch.exists('/workspace/a.md')",
        "    await scratch.history('/workspace/a.md')",
        "    await scratch.diff('/workspace/a.md')",
        "    await scratch.rename('/workspace/a.md', '/workspace/b.md')",
        "    await scratch.move('/workspace/b.md', '/workspace/c.md')",
        "    await scratch.copy('/workspace/c.md', '/workspace/d.md')",
        "    await scratch.undo('/workspace/d.md')",
        "    await scratch.finalize('/outputs/report.md')",
        "  },",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut } = await extractNativeAndFallback({
        source,
        callNames: ["workspace", "tool"],
      });

      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "matches property-access workspace calls without config objects",
    async () => {
      const source = [
        'const qk = { workspaces: { workspace: (id: string) => ["workspace", id] } }',
        "",
        "export function useWorkspace(workspaceId: string) {",
        "  const key = qk.workspaces.workspace(workspaceId)",
        "  return key",
        "}",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["workspace"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(1);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native safety facts from Rust/Oxc records",
    async () => {
      const source = [
        "const writerPrompt = prompt({ id: 'writer' })",
        "const validateTone = () => true",
        "const runGuardrail = () => true",
        "",
        "export const safeTone = constraint({",
        "  name: 'safe-tone',",
        "  severity: 'high',",
        "  appliesTo: writerPrompt,",
        "  validate: validateTone,",
        "})",
        "",
        "export const outputGuard = guardrail({",
        "  name: 'output-guard',",
        "  phase: 'output',",
        "  targets: ['prompt:writer'],",
        "  run: runGuardrail,",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["prompt", "constraint", "guardrail"],
        },
      );

      expect(nativeFactCount(record, "safety")).toBe(2);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native scorer facts from Rust/Oxc records",
    async () => {
      const longCriteria = `${"A".repeat(241)}`;
      const source = [
        "const modelId = 'gpt-test'",
        "const scoreAnswer = () => 1",
        "",
        "export const relevanceJudge = llmJudge({",
        "  id: 'relevance',",
        "  model: modelId,",
        "  threshold: 0.75,",
        "  temperature: 0.1,",
        "  samples: 3,",
        "  scale: { min: 0, max: 1 },",
        "  rubric: { answer: true },",
        '  detailSchema: { score: "number" },',
        "  chainOfThought: false,",
        `  criteria: '${longCriteria}',`,
        "  settings: { topP: 0.8, strict: true },",
        "  score: scoreAnswer,",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["llmJudge"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(1);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native RAG retriever and pipeline facts from Rust/Oxc records",
    async () => {
      const source = [
        "export const docsRetriever = retriever({ id: 'docs', namespace: 'public' })",
        "",
        "export const docsRag = retrievalPipeline(docsRetriever, [",
        "  { name: 'lookup', retriever: docsRetriever },",
        "])",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["retriever", "retrievalPipeline"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(2);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native storage facts and dependencies from Rust/Oxc records",
    async () => {
      const source = [
        "export const records = inMemoryRecordStore()",
        "export const vectors = inMemoryVectorStore()",
        "export const blobs = inMemoryBlobStore()",
        "export const appStorage = storage({ records, vectors, blobs })",
        "export const literalStorage = { records, vectors, blobs }",
        "export const tenantStorage = storage.scope(appStorage, 'tenant-a')",
        "",
        "export const docsRetriever = retriever({",
        "  id: 'docs',",
        "  storage: appStorage,",
        "  records,",
        "  vectors,",
        "})",
        "",
        "export const scratch = workspace({",
        "  id: 'scratch',",
        "  storage: tenantStorage,",
        "  records,",
        "  blobs,",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: [
          "inMemoryRecordStore",
          "inMemoryVectorStore",
          "inMemoryBlobStore",
          "storage",
          "scope",
          "retriever",
          "workspace",
        ],
      });

      expect(nativeFactCount(record, "storage")).toBe(6);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native registry and registry skill facts from Rust/Oxc records",
    async () => {
      const source = [
        "const registryAuth = () => 'token'",
        "",
        "export const acme = registry({",
        "  name: 'acme',",
        "  baseUrl: 'https://skills.acme.test',",
        "  auth: registryAuth,",
        "})",
        "",
        "export const brand = skill.fromRegistry(acme, 'brand-guidelines')",
        "export const seo = skill.fromRegistry(skillsSh, 'owner/repo/seo')",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["registry", "fromRegistry"],
        },
      );

      expect(record.nativeFacts ?? []).toHaveLength(3);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native eval facts from Rust/Oxc records",
    async () => {
      const source = [
        "export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        "",
        "export const writerEval = evaluate('prompt.writer', {",
        "  task: writerPrompt,",
        "  data: [{ name: 'draft title', input: {}, expect: async (ctx) => { ctx.expect(true) } }],",
        "  expect: async (ctx) => {",
        "    ctx.assert(true)",
        "  },",
        "})",
      ].join("\n");
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["prompt", "evaluate"],
        },
      );

      expect(nativeFactCount(record, "eval")).toBe(1);
      expectNativeExtractionParity(nativeOut, fallbackOut);
    },
    30_000,
  );
});

function nativeFactCount(
  record: {
    readonly nativeFacts?: readonly {
      readonly replaces?: readonly { readonly extractor: string }[];
    }[];
  },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) =>
    fact.replaces?.some((item) => item.extractor === extractor),
  ).length;
}
