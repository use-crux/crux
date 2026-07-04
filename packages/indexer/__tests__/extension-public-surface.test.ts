import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('public indexer extension surface', () => {
  it('documents package entry barrels as module surfaces', async () => {
    for (const file of [
      'index.ts',
      'extensions.ts',
      'source-resolver.ts',
      'testing.ts',
      'host/index.ts',
      'host/runtime.ts',
      'host/semantic.ts',
      'host/static-compat.ts',
      'host/static-index.ts',
      'contracts/parity/index.ts',
      'contracts/semantic/index.ts',
      'contracts/static-index/index.ts',
      'contracts/static-syntax/index.ts',
      'contracts/worker-events/index.ts',
    ]) {
      const source = await readFile(join(testDir, '..', file), 'utf8')
      expect(source, file).toContain('@module')
    }
  })

  it('keeps package subpath exports limited to stable entry points', async () => {
    const source = await readFile(join(testDir, '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(source) as { exports?: Record<string, unknown> }

    expect(Object.keys(parsed.exports ?? {}).sort()).toEqual([
      '.',
      './contracts/parity',
      './contracts/semantic',
      './contracts/static-index',
      './contracts/static-syntax',
      './contracts/worker-events',
      './extensions',
      './host',
      './host/runtime',
      './host/semantic',
      './host/static-compat',
      './host/static-index',
      './source-resolver',
      './testing',
    ])
  })

  it('keeps the root package barrel on compiler and engine entry points', async () => {
    const source = await readFile(join(testDir, '..', 'index.ts'), 'utf8')

    expect(namedValueExports(source)).toEqual([
      'indexProject',
      'indexProjectAst',
      'indexProjectAstFromSyntaxRecordProvider',
      'indexProjectAstFromSyntaxRecords',
      'indexProjectRuntime',
      'indexProjectSemantic',
      'diffRuntimeArtifactDrift',
      'generateRuntimeArtifacts',
      'manifestFromDefinitions',
      'runRuntimeOperation',
      'resolveProjectModel',
      'inspectProjectStaticSyntaxPlan',
      'inspectProjectStaticIndexConfig',
      'inspectProjectConfig',
      'indexProjectIncremental',
      'builtInRelationPolicies',
      'createRelationPolicyTable',
      'mergeRelationsByIdentity',
      'relationDiagnosticsFromReport',
      'relationIdentity',
      'resolveRelationModel',
      'withResolvedRelationReadModel',
    ])
    expect(namedTypeExports(source)).toEqual([
      'IndexProjectAstFromSyntaxRecordProviderOptions',
      'IndexProjectAstFromSyntaxRecordsOptions',
      'IndexProjectOptions',
      'IndexProjectRuntimeOptions',
      'ProjectModelResolutionMode',
      'GenerateRuntimeArtifactsOptions',
      'RuntimeArtifactGenerationResult',
      'RuntimeArtifactDriftReport',
      'RuntimeArtifactMissingTarget',
      'RuntimeOperationKind',
      'RuntimeOperationOptions',
      'RuntimeOperationResult',
      'ResolveProjectModelOptions',
      'InspectProjectStaticSyntaxPlanOptions',
      'ProjectStaticSyntaxPlan',
      'InspectProjectStaticIndexConfigOptions',
      'ProjectStaticIndexConfig',
      'ProjectStaticIndexExtensionReference',
      'InspectProjectConfigOptions',
      'ProjectConfigFileOrigin',
      'ProjectConfigFileStatus',
      'ProjectConfigInspect',
      'ProjectConfigList',
      'ProjectConfigOrigin',
      'ProjectConfigSetting',
      'StaticExtractionTiming',
      'StaticExtractionTimingName',
      'IncrementalExecutionMode',
      'IncrementalExecutionReport',
      'IncrementalIndexExecutionResult',
      'IncrementalPatchCounts',
      'IncrementalSemanticStatus',
      'IndexProjectIncrementalOptions',
      'IndexPatch',
      'IndexPatchBudget',
      'IndexPatchFacts',
      'IndexPatchPhase',
      'IndexPatchStatus',
      'SemanticBackendName',
      'SemanticBackendSelection',
      'SemanticSourceProfile',
      'SemanticSourceProfileFile',
      'SemanticSourceProfileHints',
      'NativeSemanticBackendSelection',
      'TypeScriptSemanticBackendSelection',
      'SemanticIndexInstrumentation',
      'SemanticIndexTiming',
      'SemanticIndexTimingName',
      'IndexRelationPolicy',
      'IndexRelationPresentation',
      'RelationFactRef',
      'RelationModel',
      'RelationModelInput',
      'RelationPolicyTable',
      'RelationResolutionReport',
      'UnresolvedRelationReason',
      'UnresolvedRelationRef',
    ])
    expect(source).not.toContain('StaticFactParser')
    expect(source).not.toContain('createStaticExtractionParser')
    expect(source).not.toContain("from './indexer/static/extraction/parser'")
    expect(source).not.toContain("from './indexer/static/extraction/match'")
    expect(source).not.toContain("from './indexer/static/extraction/tree-paths'")
    expect(source).not.toContain("from 'typescript'")
  })

  it('keeps Crux-owned host facades split by lane', async () => {
    const staticIndex = await readFile(join(testDir, '..', 'host/static-index.ts'), 'utf8')
    const semantic = await readFile(join(testDir, '..', 'host/semantic.ts'), 'utf8')
    const runtime = await readFile(join(testDir, '..', 'host/runtime.ts'), 'utf8')
    const staticCompat = await readFile(join(testDir, '..', 'host/static-compat.ts'), 'utf8')

    expect(namedValueExports(staticIndex)).toEqual([
      'astIndexPatchFromCompilerResult',
      'compileProjectIndex',
      'createProjectIndexCompiler',
      'projectIndexSnapshotFromCompilerResult',
      'createStaticExtraction',
      'staticDefinitionFiles',
      'createTypeScriptStaticSyntaxFrontend',
    ])
    expect(namedTypeExports(staticIndex)).toEqual([
      'ProjectIndexCompileMode',
      'ProjectIndexCompiler',
      'ProjectIndexCompilerInput',
      'ProjectIndexCompilerResult',
      'CompilerOwnedProjection',
      'ProjectIndexCompilerProfile',
      'SourceReader',
      'StaticExtractionEngine',
      'StaticExtractionInstrumentation',
      'StaticExtractionOptions',
      'StaticFileExtraction',
      'StaticParseCacheHit',
      'StaticParseCacheStore',
      'ProvidedStaticSyntaxRecordProvider',
      'StaticSyntaxFrontendFactory',
    ])
    expect(namedValueExports(semantic)).toEqual([
      'createNativeSemanticBackend',
      'createSemanticIndexService',
      'createTypeScriptSemanticBackend',
      'nativeSemanticBackendCapabilities',
      'nativeSemanticBackendIdentity',
      'typescriptSemanticBackendCapabilities',
      'typescriptSemanticBackendIdentity',
    ])
    expect(namedTypeExports(semantic)).toEqual([
      'NativeSemanticBackendOptions',
      'SemanticAnalyzeInput',
      'SemanticAnalyzeResult',
      'SemanticBackend',
      'SemanticBackendCapabilities',
      'SemanticBackendIdentity',
      'SemanticBackendOption',
      'SemanticBackendSelectionEnv',
      'SemanticBackendSession',
      'SemanticBackendSessionInput',
      'SemanticCompilerDeclaration',
      'SemanticCompilerNode',
      'SemanticCompilerSourceFile',
      'SemanticCompilerSymbol',
      'SemanticCompilerType',
      'SemanticCompilerView',
      'SemanticEvidenceBatch',
      'SemanticEvidenceBatchKind',
      'SemanticEvidenceBatchSource',
      'SemanticIndexService',
      'SemanticIndexServiceOptions',
      'SemanticProjectSessionIdentity',
      'SemanticSyntaxKind',
      'SemanticSyntaxNode',
      'SemanticSyntaxNodeOf',
      'SemanticSyntaxSourceFile',
      'SemanticSyntaxView',
      'TypeScriptSemanticBackendOptions',
    ])
    expect(namedValueExports(runtime)).toEqual(['runtimeIndexPatchFromCompilerResult'])
    expect(namedTypeExports(runtime)).toEqual(['ProjectIndexCompilerResult'])
    expect(namedValueExports(staticCompat)).toEqual([
      'checkStaticRulesForProject',
      'extractStaticEvidenceBatchForProject',
      'loadStaticExtensionHostManifestForProject',
    ])
    expect(namedTypeExports(staticCompat)).toEqual([
      'CheckStaticRulesForProjectInput',
      'ExtractStaticEvidenceBatchForProjectInput',
      'StaticExtensionWorkerProjectInput',
      'LoadStaticExtensionHostManifestForProjectInput',
      'StaticIndexExtensionHostProjectInput',
      'CheckStaticRulesInput',
      'CheckStaticRulesResult',
      'ExtractStaticEvidenceBatchInput',
      'ExtractStaticEvidenceBatchResult',
      'LoadStaticExtensionHostManifestInput',
      'LoadStaticExtensionHostManifestResult',
    ])
    for (const oldFile of ['internal-host.ts', 'worker-host.ts', 'worker-protocol.ts']) {
      await expect(readFile(join(testDir, '..', oldFile), 'utf8'), oldFile).rejects.toMatchObject({
        code: 'ENOENT',
      })
    }
  })

  it('keeps worker and Static Index protocols under contract barrels', async () => {
    const workerEvents = await readFile(join(testDir, '..', 'contracts/worker-events/index.ts'), 'utf8')
    const staticIndex = await readFile(join(testDir, '..', 'contracts/static-index/index.ts'), 'utf8')

    expect(namedValueExports(workerEvents)).toEqual([
      'PROJECT_INDEX_WORKER_PROTOCOL_VERSION',
      'factEnvelopesFromIndexPatch',
      'indexPatchFromWorkerEvents',
      'indexPatchToWorkerEventStream',
      'indexPatchToWorkerEvents',
      'projectIndexArtifactToWorkerEvent',
      'workerEventFixtureOptions',
      'workerEventFixturePatch',
    ])
    expect(namedValueExports(staticIndex)).toEqual([
      'STATIC_INDEX_COMPILER_PROTOCOL_VERSION',
      'StaticIndexAnalyzeRequestSchema',
      'StaticIndexAnalyzeResponseSchema',
      'StaticIndexCompileRequestSchema',
      'StaticIndexCompileResponseSchema',
      'StaticIndexCompilerRequestSchema',
      'StaticIndexCompilerResponseSchema',
      'StaticIndexFileInputSchema',
      'StaticIndexFinalizeRequestSchema',
      'StaticIndexFinalizeResponseSchema',
      'StaticIndexIdentityComponentSchema',
      'StaticIndexIdentityManifestSchema',
      'StaticIndexLintSuppressionSchema',
      'StaticIndexParserCallInterestSchema',
      'StaticIndexParserCallbackInterestSchema',
      'StaticIndexParserConstructorInterestSchema',
      'StaticIndexPrepareRequestSchema',
      'StaticIndexPrepareResponseSchema',
      'StaticIndexPreparedPlanSchema',
      'StaticIndexRunIdentitySchema',
      'StaticIndexSourceFileSchema',
      'StaticIndexTelemetrySchema',
      'createStaticIndexRunIdentity',
      'parseStaticIndexCompilerRequest',
      'staticIndexCompilerRequestFixtures',
      'staticIndexCompilerResponseFixtures',
      'staticIndexIdentityManifestFixture',
      'staticIndexPreparedPlanFixture',
      'staticIndexRunIdentityFixture',
      'staticIndexSourceFileFixture',
      'staticIndexTelemetryFixture',
    ])
    expect(workerEvents).not.toContain('../indexer/worker-protocol')
    expect(staticIndex).not.toContain('../indexer/static-index/protocol')
  })

  it('keeps the experimental authoring barrel intentionally small', async () => {
    const source = await readFile(join(testDir, '..', 'extensions.ts'), 'utf8')

    expect(namedValueExports(source)).toEqual([
      'callPattern',
      'facts',
      'INDEXER_EXTENSION_API_VERSION',
      'isIndexerExtensionAllowed',
      'loadIndexerExtensionReferences',
      'newPattern',
      'none',
      'PROJECT_INDEX_SCHEMA_VERSION',
      'projectDefinition',
      'resolveIndexerExtensionReferences',
      'validateIndexerExtensionManifest',
    ])
    expect(namedTypeExports(source)).toEqual([
      'InstalledIndexerExtension',
      'LoadIndexerExtensionReferencesInput',
      'ResolvedIndexerExtension',
      'ResolveIndexerExtensionReferencesInput',
      'ResolveIndexerExtensionReferencesResult',
      'IndexerExtensionManifestValidation',
      'ArgumentReader',
      'ConfigCallReader',
      'ConfigReader',
      'ConfiguredObjectReader',
      'DefinitionBuilder',
      'DefinitionBuilderInput',
      'ExtensionIdentity',
      'ExtensionReference',
      'ExtensionTrustMode',
      'ExtensionTrustPolicy',
      'ExtractMatch',
      'ExtractPattern',
      'ExtractResult',
      'ExtractedDefinition',
      'ExtractedFacts',
      'ExtractedSourceRef',
      'IndexDependency',
      'IndexerCompatibility',
      'IndexerExtensionConfig',
      'IndexRule',
      'IndexRuleContext',
      'RelationSpec',
      'ReferenceBuilder',
      'SemanticReadModel',
      'SemanticSymbol',
      'SemanticType',
      'SourceView',
      'SourceReference',
      'SourceRefBuilder',
      'UnresolvedReference',
      'IndexFactKind',
      'IndexRuleBudget',
      'IndexRuleFidelity',
      'IndexRuleManifest',
      'IndexRulePhase',
    ])
    expect(publicInterfaces(source)).toEqual(['ExtractContext', 'IndexExtractor', 'IndexerExtension'])
    expect(source).not.toContain('IndexResolver')
    expect(source).not.toContain('IndexEmitter')
    expect(source).not.toContain('IndexQuery')
    expect(source).not.toContain('unstableNative')
    expect(source).not.toContain('internalNative')
    expect(source).not.toContain('Program')
    expect(source).not.toContain('TypeChecker')
    expect(source).not.toContain('ts.Node')
    expect(source).not.toContain("from 'typescript'")
  })

  it('keeps the fixture testing barrel source-text oriented', async () => {
    const source = await readFile(join(testDir, '..', 'testing.ts'), 'utf8')

    expect(publicInterfaces(source)).toEqual(['IndexerExtensionFixture', 'FixtureExtraction'])
    expect(namedFunctionExports(source)).toEqual([
      'defineIndexerExtensionFixture',
      'validateIndexerExtensionFixture',
      'extractFixtureSource',
      'assertDeterministicExtraction',
    ])
    expect(source).not.toContain('ts.Node')
    expect(source).not.toContain('ts.Expression')
    expect(source).not.toContain('StaticFactParser')
    expect(source).not.toContain('internalNative')
  })

  it('keeps the source resolver barrel focused on source-map lookup', async () => {
    const source = await readFile(join(testDir, '..', 'source-resolver.ts'), 'utf8')

    expect(namedValueExports(source)).toEqual([
      'SourceResolver',
      'errorMessage',
      'parseSourceResolverWorkerRequest',
      'serializeSourceResolverWorkerResponse',
    ])
    expect(namedTypeExports(source)).toEqual([
      'ParsedSourceResolverWorkerRequest',
      'ResolvedFnSource',
      'ResolvedLocation',
      'ResolvedSourceFrame',
      'SourceFrameLine',
      'SourceFrameLineRole',
      'SourceFrameOptions',
      'SourceFrameResolution',
      'SourceFrameResolverKind',
      'SourceFrameUnavailable',
      'SourceFrameUnavailableReason',
      'SourceLocation',
      'SourceResolverFileSystem',
      'SourceResolverOptions',
      'SourceResolverWorkerRequest',
    ])
  })
})

function namedValueExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+\{\s*([^}]+?)\s*\}/gs)].flatMap((match) => exportedNames(match[1] ?? ''))
}

function namedTypeExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+type\s+\{\s*([^}]+?)\s*\}/gs)].flatMap((match) => exportedNames(match[1] ?? ''))
}

function publicInterfaces(source: string): readonly string[] {
  return [...source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '')
}

function namedFunctionExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '')
}

function exportedNames(block: string): readonly string[] {
  return block
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
