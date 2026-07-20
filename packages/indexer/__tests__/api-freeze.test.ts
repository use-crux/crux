import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('API freeze guardrails', () => {
  it('keeps the host aggregate barrel explicit instead of wildcarding every host subpath', async () => {
    const source = await readFile(join(testDir, '..', 'src/host/index.ts'), 'utf8')

    expect(source).not.toMatch(/export\s+\*\s+from/)
    expect(namedValueExports(source)).toEqual([
      'inspectProjectStaticIndexConfig',
      'inspectProjectStaticSyntaxPlan',
      'staticDefinitionFiles',
      'createNativeSemanticBackend',
      'createSemanticIndexService',
      'createTypeScriptSemanticBackend',
      'nativeSemanticBackendCapabilities',
      'nativeSemanticBackendIdentity',
      'typescriptSemanticBackendCapabilities',
      'typescriptSemanticBackendIdentity',
      'indexProjectRuntimeForHost',
      'diffRuntimeArtifactDrift',
      'generateRuntimeArtifacts',
      'manifestFromDefinitions',
      'runRuntimeOperation',
      'runSetupOperation',
      'runSetupPlanningOperation',
      'resolveProjectModel',
      'inspectProjectConfig',
      'createProjectIndexDeploymentManifest',
      'checkStaticRulesForProject',
      'extractStaticEvidenceBatchForProject',
      'loadStaticExtensionHostManifestForProject',
    ])
    expect(namedValueExports(source)).not.toEqual(
      expect.arrayContaining([
        'compileProjectIndex',
        'createProjectIndexCompiler',
        'createStaticExtraction',
        'indexProjectAstFromSyntaxRecordsForHost',
        'runtimeIndexPatchFromCompilerResult',
      ]),
    )
  })
})

function namedValueExports(source: string): readonly string[] {
  return [...source.matchAll(/export\s+\{\s*([^}]+?)\s*\}/gs)].flatMap((match) => exportedNames(match[1] ?? ''))
}

function exportedNames(block: string): readonly string[] {
  return block
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
