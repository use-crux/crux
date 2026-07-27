import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('media classifier strategy indexing', () => {
  itWithRustOxc('projects authored strip with only classifier-safe config', async () => {
    const secrets = [
      'https://private.example.test/media/credential',
      'provider-api-key-must-not-leak',
      'arbitrary-extra-secret',
    ]
    const { nativeOut } = await extractNativeAndFallback({
      source: [
        "import { boundary, guardrail } from '@use-crux/core/safety'",
        '',
        'declare const generate: unknown',
        `const credentials = { apiKey: '${secrets[1]}', self: credentials }`,
        "const model = { provider: 'private', credentials }",
        '',
        'export const classifiedMedia = guardrail({',
        "  id: 'classified-media',",
        '  on: [boundary.input.media(), boundary.output.media()] as const,',
        '  run: guardrail.mediaClassifier({',
        '    generate,',
        '    model,',
        '    categories: [',
        "      { id: 'unsafe', description: 'Authored private rubric.' },",
        `      { id: '__proto__', description: '${secrets[0]}' },`,
        '    ],',
        '    threshold: 0.8,',
        "    thresholds: { unsafe: 0.9, '__proto__': 0.95 },",
        "    action: 'strip',",
        "    modalities: ['image', 'file'],",
        "    unsupported: 'strip',",
        `    extra: '${secrets[2]}',`,
        '  }),',
        '})',
      ].join('\n'),
      callNames: ['guardrail', 'mediaClassifier'],
    })
    const definition = nativeOut.definitions.find(
      (item) => item.id === 'guardrail:classified-media',
    )
    const thresholds = Object.fromEntries([
      ['unsafe', 0.9],
      ['__proto__', 0.95],
    ])

    expect(definition).toMatchObject({
      metadata: {
        boundary: 'model.input.media',
        boundaries: ['model.input.media', 'model.output.media'],
        strategy: {
          kind: 'mediaClassifier',
          config: {
            categoryIds: ['unsafe', '__proto__'],
            threshold: 0.8,
            thresholds,
            action: 'strip',
            modalities: ['image', 'file'],
            unsupported: 'strip',
          },
        },
        facts: {
          boundary: 'model.input.media',
          boundaries: ['model.input.media', 'model.output.media'],
          strategy: {
            kind: 'mediaClassifier',
            config: {
              categoryIds: ['unsafe', '__proto__'],
              threshold: 0.8,
              thresholds,
              action: 'strip',
              modalities: ['image', 'file'],
              unsupported: 'strip',
            },
          },
        },
      },
    })
    const serialized = JSON.stringify(nativeOut)
    for (const secret of secrets) expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('Authored private rubric.')
    expect(definition?.metadata?.strategy).toEqual({
      kind: 'mediaClassifier',
      config: {
        categoryIds: ['unsafe', '__proto__'],
        threshold: 0.8,
        thresholds,
        action: 'strip',
        modalities: ['image', 'file'],
        unsupported: 'strip',
      },
    })
    expect(definition).not.toHaveProperty('sourceSnippet')
  }, 30_000)

  itWithRustOxc('rejects authored throw and omits incomplete projections', async () => {
    const { nativeOut } = await extractNativeAndFallback({
      source: [
        "import { boundary, guardrail } from '@use-crux/core/safety'",
        '',
        'declare const generate: unknown',
        'declare const model: unknown',
        'declare const dynamicOptions: unknown',
        'declare const dynamicCategory: unknown',
        'declare const dynamicModality: unknown',
        'declare const spread: unknown',
        '',
        'const cyclicCategories = [cyclicCategories]',
        'const cyclicOptions = {',
        '  generate, model,',
        '  categories: cyclicCategories,',
        '  threshold: 0.8,',
        '}',
        'const partialOptions = { generate, model, categories: [dynamicCategory], threshold: 0.8 }',
        "const spreadOptions = { generate, model, categories: [{ id: 'unsafe', description: 'Safe.' }], threshold: 0.8, ...spread }",
        "const modalityOptions = { generate, model, categories: [{ id: 'unsafe', description: 'Safe.' }], threshold: 0.8, modalities: [dynamicModality] }",
        "const nonFiniteOptions = { generate, model, categories: [{ id: 'unsafe', description: 'Safe.' }], threshold: 1e999 }",
        "const authoredThrowOptions = { generate, model, categories: [{ id: 'unsafe', description: 'Safe.' }], threshold: 0.8, unsupported: 'throw' }",
        '',
        ...[
          ['authoredThrow', 'authoredThrowOptions'],
          ['dynamic', 'dynamicOptions'],
          ['partial', 'partialOptions'],
          ['spread', 'spreadOptions'],
          ['modality', 'modalityOptions'],
          ['nonFinite', 'nonFiniteOptions'],
          ['cyclic', 'cyclicOptions'],
        ].flatMap(([name, options]) => [
            `export const ${name} = guardrail({`,
            `  id: '${name}',`,
            '  on: boundary.input.media(),',
            `  run: guardrail.mediaClassifier(${options}),`,
            '})',
          ]),
      ].join('\n'),
      callNames: ['guardrail', 'mediaClassifier'],
    })

    for (
      const id of
        ['authoredThrow', 'dynamic', 'partial', 'spread', 'modality', 'nonFinite', 'cyclic']
    ) {
      const definition = nativeOut.definitions.find(
        (item) => item.id === `guardrail:${id}`,
      )
      expect(definition).toMatchObject({
        metadata: {
          strategy: { kind: 'mediaClassifier' },
          facts: { strategy: { kind: 'mediaClassifier' } },
        },
      })
      expect(definition?.metadata?.strategy).not.toHaveProperty('config')
      expect(definition?.metadata?.facts).not.toHaveProperty('strategy.config')
    }
  }, 30_000)
})
