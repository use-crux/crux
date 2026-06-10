import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('public indexer extension surface', () => {
  it('keeps package subpath exports limited to stable entry points', async () => {
    const source = await readFile(join(testDir, '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(source) as { exports?: Record<string, unknown> }

    expect(Object.keys(parsed.exports ?? {}).sort()).toEqual(['.', './extensions', './source-resolver', './testing'])
  })

  it('keeps the root package barrel on compiler and engine entry points', async () => {
    const source = await readFile(join(testDir, '..', 'index.ts'), 'utf8')

    expect(namedValueExports(source)).toEqual([
      'indexProject',
      'indexProjectAst',
      'indexProjectSemantic',
      'indexProjectIncremental',
      'astIndexPatchFromCompilerResult',
      'compileProjectIndex',
      'createProjectIndexCompiler',
      'projectIndexSnapshotFromCompilerResult',
      'createStaticExtraction',
      'builtInRelationPolicies',
      'createRelationPolicyTable',
      'mergeRelationsByIdentity',
      'relationDiagnosticsFromReport',
      'relationIdentity',
      'resolveRelationModel',
      'withResolvedRelationReadModel',
    ])
    expect(namedTypeExports(source)).toEqual([
      'IndexProjectOptions',
      'ProjectIndexCompiler',
      'ProjectIndexCompileMode',
      'ProjectIndexCompilerInput',
      'ProjectIndexCompilerResult',
      'CompilerOwnedProjection',
      'ProjectIndexCompilerProfile',
      'SourceReader',
      'StaticExtractionEngine',
      'StaticExtractionOptions',
      'StaticFileExtraction',
      'StaticParseCacheStore',
      'IncrementalExecutionMode',
      'IncrementalExecutionReport',
      'IncrementalIndexExecutionResult',
      'IndexProjectIncrementalOptions',
      'IndexPatch',
      'IndexPatchBudget',
      'IndexPatchFacts',
      'IndexPatchPhase',
      'IndexPatchStatus',
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
      'AnalysisTier',
      'ConfigCallReader',
      'ConfigReader',
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
      'IndexRuleMeta',
      'RelationSpec',
      'ReferenceBuilder',
      'SemanticReadModel',
      'SemanticSymbol',
      'SemanticType',
      'SourceView',
      'SourceReference',
      'SourceRefBuilder',
      'UnresolvedReference',
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
