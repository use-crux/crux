import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveIndexerExtensionReferences,
  validateIndexerExtensionManifest,
  type IndexerExtension,
} from "../src/extensions";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("public indexer extension surface", () => {
  it("rejects inherited reserved compiler slots from untyped manifests", () => {
    for (const slot of [
      "static",
      "resolvers",
      "rules",
      "emitters",
      "queries",
    ] as const) {
      const extension = Object.assign(
        Object.create({ [slot]: slot === "static" ? {} : [] }),
        {
          name: `@acme/reserved-${slot}`,
          version: "1.0.0",
          crux: { indexer: "0.1.0", projectIndexSchema: 1 },
        },
      ) as IndexerExtension;

      expect(validateIndexerExtensionManifest(extension)).toEqual({
        valid: false,
        errors: [`Reserved compiler extension slots are not public: ${slot}.`],
      });

      const resolved = resolveIndexerExtensionReferences({
        config: {
          extensions: [{ package: extension.name }],
          trust: { mode: "allowlisted", allow: [extension.name] },
        },
        installed: [{ package: extension.name, extension }],
      });

      expect(resolved.extensions, slot).toEqual([]);
      expect(
        resolved.diagnostics.map((diagnostic) => diagnostic.code),
        slot,
      ).toEqual(["index.extension_invalid_manifest"]);
    }
  });

  it("documents package entry barrels as module surfaces", async () => {
    for (const file of [
      "src/index.ts",
      "src/extensions.ts",
      "src/source-resolver.ts",
      "src/testing.ts",
      "src/host/index.ts",
      "src/host/runtime.ts",
      "src/host/semantic.ts",
      "src/host/static-compat.ts",
      "src/host/static-index.ts",
      "src/contracts/parity/index.ts",
      "src/contracts/semantic/index.ts",
      "src/contracts/static-index/index.ts",
      "src/contracts/static-syntax/index.ts",
      "src/contracts/worker-events/index.ts",
    ]) {
      const source = await readFile(join(testDir, "..", file), "utf8");
      expect(source, file).toContain("@module");
    }
  });

  it("keeps package subpath exports limited to stable entry points", async () => {
    const source = await readFile(join(testDir, "..", "package.json"), "utf8");
    const parsed = JSON.parse(source) as { exports?: Record<string, unknown> };

    const exports = parsed.exports ?? {};
    const publicExports = Object.keys(exports).filter(
      (subpath) => !subpath.startsWith("./internal/"),
    );

    expect(publicExports.sort()).toEqual([
      ".",
      "./contracts/parity",
      "./contracts/semantic",
      "./contracts/static-index",
      "./contracts/static-syntax",
      "./contracts/worker-events",
      "./extensions",
      "./host",
      "./host/runtime",
      "./host/semantic",
      "./host/static-compat",
      "./host/static-index",
      "./source-resolver",
      "./testing",
    ]);
    expect(
      Object.keys(exports).filter((subpath) =>
        subpath.startsWith("./internal/"),
      ),
    ).toEqual(["./internal/user-import"]);
  });

  it("keeps the root package barrel on Crux-owned compiler contracts", async () => {
    const source = await readFile(join(testDir, "..", "src/index.ts"), "utf8");

    expect(namedValueExports(source)).toEqual([]);
    expect(namedTypeExports(source)).toEqual([
      "IndexPatch",
      "IndexPatchBudget",
      "IndexPatchFacts",
      "IndexPatchPhase",
      "IndexPatchStatus",
      "SemanticBackendName",
      "SemanticBackendSelection",
      "SemanticSourceProfile",
      "SemanticSourceProfileFile",
      "SemanticSourceProfileHints",
      "SemanticIndexInstrumentation",
      "SemanticIndexTiming",
      "SemanticIndexTimingName",
      "StaticExtractionTiming",
      "StaticExtractionTimingName",
    ]);
    expect(source).not.toContain("from './indexer/extensions'");
    expect(source).not.toContain("StaticFactParser");
    expect(source).not.toContain("createStaticExtractionParser");
    expect(source).not.toContain("from './indexer/static/extraction/parser'");
    expect(source).not.toContain("from './indexer/static/extraction/match'");
    expect(source).not.toContain(
      "from './indexer/static/extraction/tree-paths'",
    );
    expect(source).not.toContain("from 'typescript'");
  });

  it("keeps Crux-owned host facades split by lane", async () => {
    const staticIndex = await readFile(
      join(testDir, "..", "src/host/static-index.ts"),
      "utf8",
    );
    const semantic = await readFile(
      join(testDir, "..", "src/host/semantic.ts"),
      "utf8",
    );
    const runtime = await readFile(
      join(testDir, "..", "src/host/runtime.ts"),
      "utf8",
    );
    const staticCompat = await readFile(
      join(testDir, "..", "src/host/static-compat.ts"),
      "utf8",
    );

    expect(namedValueExports(staticIndex)).toEqual([
      "staticDefinitionFiles",
      "inspectProjectStaticIndexConfig",
      "STATIC_INDEX_COMPILER_PROTOCOL_VERSION",
    ]);
    expect(namedTypeExports(staticIndex)).toEqual([
      "InspectProjectStaticIndexConfigOptions",
      "ProjectStaticIndexConfig",
      "ProjectStaticIndexExtensionReference",
    ]);
    expect(staticIndex).not.toContain("compileProjectIndex");
    expect(staticIndex).not.toContain("createStaticExtraction");
    expect(staticIndex).not.toContain("createTypeScriptStaticSyntaxFrontend");
    expect(staticIndex).not.toContain("indexProjectAstFromSyntaxRecords");
    expect(namedValueExports(semantic)).toEqual([
      "createNativeSemanticBackend",
      "createSemanticIndexService",
      "createTypeScriptSemanticBackend",
      "nativeSemanticBackendCapabilities",
      "nativeSemanticBackendIdentity",
      "typescriptSemanticBackendCapabilities",
      "typescriptSemanticBackendIdentity",
    ]);
    expect(namedTypeExports(semantic)).toEqual([
      "NativeSemanticBackendOptions",
      "SemanticAnalyzeInput",
      "SemanticAnalyzeResult",
      "SemanticBackend",
      "SemanticBackendCapabilities",
      "SemanticBackendIdentity",
      "SemanticBackendOption",
      "SemanticBackendSelectionEnv",
      "SemanticBackendSession",
      "SemanticBackendSessionInput",
      "SemanticCompilerDeclaration",
      "SemanticCompilerNode",
      "SemanticCompilerSourceFile",
      "SemanticCompilerSymbol",
      "SemanticCompilerType",
      "SemanticCompilerView",
      "SemanticEvidenceBatch",
      "SemanticEvidenceBatchKind",
      "SemanticEvidenceBatchSource",
      "SemanticIndexService",
      "SemanticIndexServiceOptions",
      "SemanticProjectSessionIdentity",
      "SemanticSyntaxKind",
      "SemanticSyntaxNode",
      "SemanticSyntaxNodeOf",
      "SemanticSyntaxSourceFile",
      "SemanticSyntaxView",
      "TypeScriptSemanticBackendOptions",
    ]);
    expect(namedValueExports(runtime)).toEqual([]);
    expect(namedTypeExports(runtime)).toEqual([]);
    expect(runtime).not.toContain("runtimeIndexPatchFromCompilerResult");
    expect(namedValueExports(staticCompat)).toEqual([
      "checkStaticRulesForProject",
      "extractStaticEvidenceBatchForProject",
      "loadStaticExtensionHostManifestForProject",
    ]);
    expect(namedTypeExports(staticCompat)).toEqual([
      "CheckStaticRulesForProjectInput",
      "ExtractStaticEvidenceBatchForProjectInput",
      "StaticExtensionWorkerProjectInput",
      "LoadStaticExtensionHostManifestForProjectInput",
      "StaticIndexExtensionHostProjectInput",
      "CheckStaticRulesInput",
      "CheckStaticRulesResult",
      "ExtractStaticEvidenceBatchInput",
      "ExtractStaticEvidenceBatchResult",
      "LoadStaticExtensionHostManifestInput",
      "LoadStaticExtensionHostManifestResult",
    ]);
    for (const oldFile of [
      "internal-host.ts",
      "worker-host.ts",
      "worker-protocol.ts",
    ]) {
      await expect(
        readFile(join(testDir, "..", oldFile), "utf8"),
        oldFile,
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("keeps worker and Static Index protocols under contract barrels", async () => {
    const workerEvents = await readFile(
      join(testDir, "..", "src/contracts/worker-events/index.ts"),
      "utf8",
    );
    const staticIndex = await readFile(
      join(testDir, "..", "src/contracts/static-index/index.ts"),
      "utf8",
    );

    expect(namedValueExports(workerEvents)).toEqual([
      "PROJECT_INDEX_WORKER_PROTOCOL_VERSION",
      "factEnvelopesFromIndexPatch",
      "indexPatchFromWorkerEvents",
      "indexPatchToWorkerEventStream",
      "indexPatchToWorkerEvents",
      "projectIndexArtifactToWorkerEvent",
      "projectIndexArtifactToWorkerEvents",
      "workerEventFixtureOptions",
      "workerEventFixturePatch",
    ]);
    expect(namedValueExports(staticIndex)).toEqual([
      "STATIC_INDEX_COMPILER_PROTOCOL_VERSION",
      "StaticIndexAnalyzeRequestSchema",
      "StaticIndexAnalyzeResponseSchema",
      "StaticIndexCompileRequestSchema",
      "StaticIndexCompileResponseSchema",
      "StaticIndexCompilerRequestSchema",
      "StaticIndexCompilerResponseSchema",
      "StaticIndexFileInputSchema",
      "StaticIndexFinalizeRequestSchema",
      "StaticIndexFinalizeResponseSchema",
      "StaticIndexIdentityComponentSchema",
      "StaticIndexIdentityManifestSchema",
      "StaticIndexLintSuppressionSchema",
      "StaticIndexParserCallInterestSchema",
      "StaticIndexParserCallbackInterestSchema",
      "StaticIndexParserConstructorInterestSchema",
      "StaticIndexPrepareRequestSchema",
      "StaticIndexPrepareResponseSchema",
      "StaticIndexPreparedPlanSchema",
      "StaticIndexRunIdentitySchema",
      "StaticIndexSourceFileSchema",
      "StaticIndexTelemetrySchema",
      "createStaticIndexRunIdentity",
      "parseStaticIndexCompilerRequest",
      "staticIndexCompilerRequestFixtures",
      "staticIndexCompilerResponseFixtures",
      "staticIndexIdentityManifestFixture",
      "staticIndexPreparedPlanFixture",
      "staticIndexRunIdentityFixture",
      "staticIndexSourceFileFixture",
      "staticIndexTelemetryFixture",
    ]);
    expect(workerEvents).not.toContain("../indexer/worker-protocol");
    expect(staticIndex).not.toContain("../indexer/static-index/protocol");
  });

  it("keeps the experimental authoring barrel intentionally small", async () => {
    const source = await readFile(
      join(testDir, "..", "src/extensions.ts"),
      "utf8",
    );

    expect(namedValueExports(source)).toEqual([
      "callPattern",
      "facts",
      "INDEXER_EXTENSION_API_VERSION",
      "isIndexerExtensionAllowed",
      "newPattern",
      "none",
      "PROJECT_INDEX_SCHEMA_VERSION",
      "projectDefinition",
    ]);
    expect(namedTypeExports(source)).toEqual([
      "ArgumentReader",
      "ConfigCallReader",
      "ConfigReader",
      "ConfiguredObjectReader",
      "DefinitionBuilder",
      "DefinitionBuilderInput",
      "ExtensionIdentity",
      "ExtensionReference",
      "ExtensionTrustMode",
      "ExtensionTrustPolicy",
      "ExtractMatch",
      "ExtractPattern",
      "ExtractResult",
      "ExtractedDefinition",
      "ExtractedFacts",
      "ExtractedSourceRef",
      "IndexDependency",
      "IndexerCompatibility",
      "IndexerExtensionConfig",
      "RelationSpec",
      "ReferenceBuilder",
      "SourceView",
      "SourceReference",
      "SourceRefBuilder",
      "UnresolvedReference",
    ]);
    expect(publicInterfaces(source)).toEqual([
      "ExtractContext",
      "IndexExtractor",
      "IndexerExtension",
      "InstalledIndexerExtension",
      "ResolvedIndexerExtension",
      "ResolveIndexerExtensionReferencesInput",
      "ResolveIndexerExtensionReferencesResult",
      "LoadIndexerExtensionReferencesInput",
      "IndexerExtensionManifestValidation",
    ]);
    expect(namedFunctionExports(source)).toEqual([
      "validateIndexerExtensionManifest",
      "resolveIndexerExtensionReferences",
      "loadIndexerExtensionReferences",
    ]);
    expect(source).not.toContain("IndexResolver");
    expect(source).not.toContain("IndexEmitter");
    expect(source).not.toContain("IndexRule");
    expect(source).not.toContain("IndexQuery");
    expect(source).not.toContain("unstableNative");
    expect(source).not.toContain("internalNative");
    expect(source).not.toContain("Program");
    expect(source).not.toContain("TypeChecker");
    expect(source).not.toContain("ts.Node");
    expect(source).not.toContain("from 'typescript'");
  });

  it("keeps the fixture testing barrel source-text oriented", async () => {
    const source = await readFile(
      join(testDir, "..", "src/testing.ts"),
      "utf8",
    );

    expect(publicInterfaces(source)).toEqual([
      "IndexerExtensionFixture",
      "FixtureExtraction",
    ]);
    expect(namedFunctionExports(source)).toEqual([
      "defineIndexerExtensionFixture",
      "validateIndexerExtensionFixture",
      "extractFixtureSource",
      "assertDeterministicExtraction",
    ]);
    expect(source).not.toContain("ts.Node");
    expect(source).not.toContain("ts.Expression");
    expect(source).not.toContain("StaticFactParser");
    expect(source).not.toContain("internalNative");
  });

  it("keeps the source resolver barrel focused on source-map lookup", async () => {
    const source = await readFile(
      join(testDir, "..", "src/source-resolver.ts"),
      "utf8",
    );

    expect(namedValueExports(source)).toEqual([
      "SourceResolver",
      "errorMessage",
      "parseSourceResolverWorkerRequest",
      "serializeSourceResolverWorkerResponse",
    ]);
    expect(namedTypeExports(source)).toEqual([
      "ParsedSourceResolverWorkerRequest",
      "ResolvedFnSource",
      "ResolvedLocation",
      "ResolvedSourceFrame",
      "SourceFrameLine",
      "SourceFrameLineRole",
      "SourceFrameOptions",
      "SourceFrameResolution",
      "SourceFrameResolverKind",
      "SourceFrameUnavailable",
      "SourceFrameUnavailableReason",
      "SourceLocation",
      "SourceResolverFileSystem",
      "SourceResolverOptions",
      "SourceResolverWorkerRequest",
    ]);
  });
});

function namedValueExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+\{\s*([^}]+?)\s*\}/gs)].flatMap(
    (match) => exportedNames(match[1] ?? ""),
  );
}

function namedTypeExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+type\s+\{\s*([^}]+?)\s*\}/gs)].flatMap(
    (match) => exportedNames(match[1] ?? ""),
  );
}

function publicInterfaces(source: string): readonly string[] {
  return [...source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g)].map(
    (match) => match[1] ?? "",
  );
}

function namedFunctionExports(source: string): readonly string[] {
  return [
    ...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g),
  ].map((match) => match[1] ?? "");
}

function exportedNames(block: string): readonly string[] {
  return block
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
