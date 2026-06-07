import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('public source-indexer extension surface', () => {
  it('keeps the experimental authoring barrel intentionally small', async () => {
    const source = await readFile(join(testDir, '..', 'extensions.ts'), 'utf8')

    expect(namedValueExports(source)).toEqual(['callPattern', 'facts', 'newPattern', 'none', 'projectDefinition'])
    expect(namedTypeExports(source)).toEqual([
      'ArgumentReader',
      'ConfigCallReader',
      'ConfigReader',
      'DefinitionBuilder',
      'DefinitionBuilderInput',
      'ExtensionIdentity',
      'ExtractMatch',
      'ExtractPattern',
      'ExtractResult',
      'ExtractedDefinition',
      'ExtractedFacts',
      'ExtractedSourceRef',
      'IndexDependency',
      'RelationSpec',
      'ReferenceBuilder',
      'SourceView',
      'SourceRefBuilder',
      'UnresolvedReference',
    ])
    expect(publicInterfaces(source)).toEqual(['ExtractContext', 'CatalogExtractor', 'SourceIndexerExtension'])
    expect(source).not.toContain('CatalogResolver')
    expect(source).not.toContain('CatalogRule')
    expect(source).not.toContain('CatalogEmitter')
    expect(source).not.toContain('IndexQuery')
    expect(source).not.toContain('unstableNative?:')
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

function exportedNames(block: string): readonly string[] {
  return block
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
