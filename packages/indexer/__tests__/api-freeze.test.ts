import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('API freeze guardrails', () => {
  it('keeps the host aggregate barrel explicit instead of wildcarding every host subpath', async () => {
    const source = await readFile(join(testDir, '..', 'host/index.ts'), 'utf8')

    expect(source).not.toMatch(/export\s+\*\s+from/)
    expect(namedValueExports(source)).toEqual([
      'astIndexPatchFromCompilerResult',
      'compileProjectIndex',
      'createProjectIndexCompiler',
      'projectIndexSnapshotFromCompilerResult',
      'createStaticExtraction',
      'staticDefinitionFiles',
      'createTypeScriptStaticSyntaxFrontend',
      'indexProjectAstFromSyntaxRecordProviderForHost',
      'indexProjectAstFromSyntaxRecordsForHost',
      'createNativeSemanticBackend',
      'createSemanticIndexService',
      'createTypeScriptSemanticBackend',
      'nativeSemanticBackendCapabilities',
      'nativeSemanticBackendIdentity',
      'typescriptSemanticBackendCapabilities',
      'typescriptSemanticBackendIdentity',
      'runtimeIndexPatchFromCompilerResult',
      'checkStaticRulesForProject',
      'extractStaticEvidenceBatchForProject',
      'loadStaticExtensionHostManifestForProject',
    ])
    expect(namedTypeExports(source)).toContain('IndexProjectAstFromSyntaxRecordsHostOptions')
    expect(namedTypeExports(source)).toContain('IndexProjectAstFromSyntaxRecordProviderHostOptions')
    expect(namedTypeExports(source)).toContain('NativeFactProjectionMode')
  })
})

function namedValueExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+\{\s*([^}]+?)\s*\}/gs)].flatMap((match) => exportedNames(match[1] ?? ''))
}

function namedTypeExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+type\s+\{\s*([^}]+?)\s*\}/gs)].flatMap((match) => exportedNames(match[1] ?? ''))
}

function exportedNames(block: string): readonly string[] {
  return block
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
