import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { callPattern, facts, type IndexerExtension } from '../indexer/extensions/public-contract'
import { loadIndexerExtensionReferences } from '../indexer/extensions/loading'
import { nativeStaticExtractorCoverage } from '../indexer/extensions/native-coverage'
import { createIndexerExtensionRuntime } from '../indexer/extensions/runtime'
import { createStaticRecordEvidenceReader } from '../indexer/extensions/static-evidence'
import { createStaticExtensionRegistry } from '../indexer/extensions/static-record-adapter'
import { collectProjectedSemanticEvidence } from '../indexer/semantic/evidence'
import { createNativeSemanticBackend } from '../indexer/semantic/native/tsgo'
import { nativeDirectPrimitiveManifest } from '../indexer/semantic/native/direct-projectors'
import { createSemanticIndexService } from '../indexer/semantic/service'
import { createTypeScriptSemanticBackend } from '../indexer/semantic/typescript'

const indexerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'indexer')

describe('indexer architecture boundaries', () => {
  it('groups extension internals behind responsibility barrels', () => {
    const extension: IndexerExtension = {
      name: '@crux/test-extension',
      version: '0.0.0',
      crux: { indexer: '^0.1.0' },
      extractors: [
        {
          name: 'test.extractor',
          patterns: [callPattern({ name: 'test' })],
          extract: () => facts({}),
        },
      ],
    }

    expect(createIndexerExtensionRuntime({ extensions: [extension] })).toEqual(
      expect.objectContaining({ extractStatic: expect.any(Function) }),
    )
    expect(createStaticExtensionRegistry([extension]).extractors).toHaveLength(1)
    expect(createStaticRecordEvidenceReader).toBeTypeOf('function')
    expect(loadIndexerExtensionReferences).toBeTypeOf('function')
    expect(nativeStaticExtractorCoverage({ extension: { name: '@crux/test-extension', version: '0.0.0' }, name: 'x' })).toMatchObject({
      covered: false,
    })

    for (const file of [
      'authoring-types.ts',
      'facts.ts',
      'loading.ts',
      'native-static-coverage.ts',
      'runtime.ts',
      'static-adapter.ts',
      'static-evidence.ts',
      'static-record-runtime.ts',
    ]) {
      expect(existsSync(join(indexerDir, 'extensions', file)), file).toBe(false)
    }

    expect(redundantContextualNames(join(indexerDir, 'extensions'))).toEqual([])
  })

  it('groups semantic internals behind evidence, TypeScript, and native backend barrels', () => {
    expect(collectProjectedSemanticEvidence).toBeTypeOf('function')
    expect(createSemanticIndexService({ backend: createTypeScriptSemanticBackend({ cache: 'disabled' }) })).toEqual(
      expect.objectContaining({ indexFiles: expect.any(Function), indexProject: expect.any(Function) }),
    )
    expect(createNativeSemanticBackend).toBeTypeOf('function')
    expect(nativeDirectPrimitiveManifest.some((spec) => spec.callName === 'prompt')).toBe(true)

    for (const file of [
      'evidence.ts',
      'facts.ts',
      'tsgo-compiler-session.ts',
      'typescript-compiler-view.ts',
      'typescript-fact-input.ts',
    ]) {
      expect(existsSync(join(indexerDir, 'semantic', file)), file).toBe(false)
    }
    expect(existsSync(join(indexerDir, 'semantic/native/direct-projectors/tsgo-native-direct-manifest.ts'))).toBe(
      false,
    )
    expect(existsSync(join(indexerDir, 'semantic/native/direct-projectors/manifest.ts'))).toBe(true)
    expect(redundantContextualNames(join(indexerDir, 'semantic'))).toEqual([])
  })
})

function redundantContextualNames(root: string): readonly string[] {
  return relativeFiles(root).filter((file) =>
    [
      /^static-record-adapter\/static-record-/,
      /^static-record-adapter\/static-(adapter|normalizer)\.ts$/,
      /^static-record-adapter\/internal-/,
      /^static-evidence\/static-(evidence|extension|interest)/,
      /^native-coverage\/(native-static|extension-host)/,
      /^runtime\/runtime/,
      /^loading\/loading/,
      /^evidence\/evidence\.ts$/,
      /tsgo-native-direct/,
    ].some((pattern) => pattern.test(file)),
  )
}

function relativeFiles(root: string): readonly string[] {
  const files: string[] = []
  collectRelativeFiles(root, '', files)
  return files.sort()
}

function collectRelativeFiles(root: string, relativeRoot: string, files: string[]): void {
  for (const entry of readdirSync(join(root, relativeRoot))) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry}` : entry
    const absolutePath = join(root, relativePath)
    if (statSync(absolutePath).isDirectory()) {
      collectRelativeFiles(root, relativePath, files)
    } else {
      files.push(relativePath)
    }
  }
}
