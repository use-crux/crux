import { describe, expect, it } from 'vitest'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import { nativeFinalizeFactsFromExtractionResults } from '../src/indexer/static-index/extension-host/evidence/host-facts'
import type { StaticExtractionResult } from '../src/indexer/extensions/runtime/engine'
import type { IndexPatch } from '../src/indexer/patches'
import { factEnvelopesFromIndexPatch } from '../src/indexer/worker-protocol/patch-events'

const writer: ProjectDefinition = {
  id: 'prompt:writer',
  kind: 'prompt',
  name: 'writer',
  fidelity: 'resolved',
  status: 'active',
}

describe('fact envelope extractor provenance', () => {
  it('retains every actual extension result contributor in canonical order', () => {
    const facts = nativeFinalizeFactsFromExtractionResults([
      extractionResult('@scope/z-extension', '2.0.0', 'zeta'),
      extractionResult('@scope/a-extension', '1.0.0', 'alpha'),
      extractionResult('@scope/a-extension', '1.0.0', 'alpha'),
      extractionResult('@use-crux/indexer/crux-core', '0.5.0', 'prompt'),
      extractionResult('@use-crux/indexer/crux-core-media', '2', 'media.operation'),
    ])

    expect(facts.definitionExtractors).toEqual({
      'prompt:writer': [
        { name: 'media.operation' },
        { name: 'prompt' },
        { name: 'alpha', extension: { name: '@scope/a-extension', version: '1.0.0' } },
        { name: 'zeta', extension: { name: '@scope/z-extension', version: '2.0.0' } },
      ],
    })
  })

  it('moves canonical attribution onto definition envelopes without changing the fact', () => {
    const patch = {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-07-15T00:00:00.000Z',
      status: 'ok',
      definitionExtractors: {
        'prompt:writer': [
          { name: 'zeta', extension: { name: '@scope/z-extension', version: '2.0.0' } },
          { name: 'prompt' },
        ],
      },
      facts: { definitions: [writer] },
    } satisfies IndexPatch

    const [envelope] = factEnvelopesFromIndexPatch(patch, {
      name: '@use-crux/indexer/project-indexer',
      version: '0.5.0',
    })

    expect(envelope?.producer).toEqual({
      name: '@use-crux/indexer/project-indexer',
      version: '0.5.0',
    })
    expect(envelope?.provenance.extractors).toEqual([
      { name: 'prompt' },
      { name: 'zeta', extension: { name: '@scope/z-extension', version: '2.0.0' } },
    ])
    expect(envelope?.fact).toEqual(writer)
  })

  it.each(['', 'bad\nextractor'])('rejects unsafe extractor identity %j', (name) => {
    const patch = {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-07-15T00:00:00.000Z',
      status: 'ok',
      definitionExtractors: { 'prompt:writer': [{ name }] },
      facts: { definitions: [writer] },
    } satisfies IndexPatch

    expect(() =>
      factEnvelopesFromIndexPatch(patch, {
        name: '@use-crux/indexer/project-indexer',
        version: '0.5.0',
      }),
    ).toThrow(/extractor/i)
  })

  it('sorts contributor fields by UTF-8 bytes across the non-BMP boundary', () => {
    const facts = nativeFinalizeFactsFromExtractionResults([
      extractionResult('@scope/extension', '1.0.0', '\u{10000}'),
      extractionResult('@scope/extension', '1.0.0', '\uE000'),
    ])

    expect(facts.definitionExtractors?.['prompt:writer']?.map((item) => item.name)).toEqual([
      '\uE000',
      '\u{10000}',
    ])
  })

  it('rejects malformed Unicode identities before JSON transport', () => {
    expect(() =>
      nativeFinalizeFactsFromExtractionResults([
        extractionResult('@scope/extension', '1.0.0', '\uD800'),
      ]),
    ).toThrow(/extractor/i)
  })
})

function extractionResult(extension: string, version: string, extractor: string): StaticExtractionResult {
  return {
    kind: 'matched',
    extension: { name: extension, version },
    extractor,
    dependencies: [],
    diagnostics: [],
    facts: { definitions: [{ variableName: 'writer', definition: writer }] },
  }
}
