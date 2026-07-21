import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('guardrail strategy indexing', () => {
  itWithRustOxc('extracts a literal helper strategy through the native contract', async () => {
    const { nativeOut, record } = await extractNativeAndFallback({
      source: [
        "import { boundary, guardrail } from '@use-crux/core/safety'",
        '',
        'export const safeAttachments = guardrail({',
        "  id: 'safe-attachments',",
        '  on: boundary.input.media(),',
        '  run: guardrail.media({',
        "    mediaTypes: { allow: ['image/png'] },",
        '    size: { maxBytes: 1024 },',
        "    sources: { allowHosts: ['cdn.example.com'] },",
        "    action: 'strip',",
        '  }),',
        '})',
      ].join('\n'),
      callNames: ['guardrail', 'media'],
    })

    expect(nativeOut.definitions.find((definition) => definition.id === 'guardrail:safe-attachments')).toMatchObject({
      metadata: {
        boundary: 'model.input.media',
        strategy: {
          kind: 'media',
          config: {
            mediaTypes: { allow: ['image/png'] },
            size: { maxBytes: 1024 },
            sources: { allowHosts: ['cdn.example.com'] },
            action: 'strip',
          },
        },
        facts: {
          strategy: {
            kind: 'media',
            config: {
              mediaTypes: { allow: ['image/png'] },
              size: { maxBytes: 1024 },
              sources: { allowHosts: ['cdn.example.com'] },
              action: 'strip',
            },
          },
        },
      },
    })
    expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toContainEqual({
      extension: '@use-crux/indexer/crux-core',
      extractor: 'safety',
    })
  }, 30_000)

  itWithRustOxc('keeps helper kind while omitting incomplete dynamic config', async () => {
    const { nativeOut } = await extractNativeAndFallback({
      source: [
        "import { boundary, constraint, guardrail } from '@use-crux/core/safety'",
        '',
        'declare const dynamicLimit: number',
        'declare const dynamicRules: Record<string, unknown>',
        'const dynamicOptions = { size: { maxBytes: dynamicLimit } }',
        '',
        'export const dynamicMedia = guardrail({',
        "  id: 'dynamic-media',",
        '  on: boundary.input.media(),',
        '  run: guardrail.media(dynamicOptions),',
        '})',
        '',
        'export const dynamicSpreadMedia = guardrail({',
        "  id: 'dynamic-spread-media',",
        '  on: boundary.input.media(),',
        '  run: guardrail.media({',
        "    mediaTypes: { allow: ['image/png'] },",
        "    action: 'strip',",
        '    ...dynamicRules,',
        '  }),',
        '})',
        '',
        'export const piiText = guardrail({',
        "  id: 'pii-text',",
        '  on: boundary.input.text(),',
        "  run: guardrail.pii({ strategy: 'redact' }),",
        '})',
        '',
        'function localPolicy(config: unknown) {',
        "  return { action: 'allow' as const, config }",
        '}',
        'export const localPolicyGuardrail = guardrail({',
        "  id: 'local-policy',",
        '  on: boundary.input.text(),',
        "  run: localPolicy({ secret: 'must-not-be-indexed' }),",
        '})',
        '',
        'const cyclicOptions = { self: cyclicOptions }',
        'export const cyclicMedia = guardrail({',
        "  id: 'cyclic-media',",
        '  on: boundary.input.media(),',
        '  run: guardrail.media(cyclicOptions),',
        '})',
        '',
        'export const nonFiniteMedia = guardrail({',
        "  id: 'non-finite-media',",
        '  on: boundary.input.media(),',
        '  run: guardrail.media({ size: { maxBytes: 1e999 } }),',
        '})',
        '',
        'export const judged = constraint({',
        "  id: 'judged',",
        '  on: boundary.output.text(),',
        "  run: constraint.judge({ model: 'test-model' }),",
        '})',
      ].join('\n'),
      callNames: ['constraint', 'guardrail', 'judge', 'media', 'pii'],
    })

    const definition = (id: string) => nativeOut.definitions.find((item) => item.id === id)
    expect(definition('guardrail:dynamic-media')).toMatchObject({
      metadata: { strategy: { kind: 'media' }, facts: { strategy: { kind: 'media' } } },
    })
    expect(definition('guardrail:dynamic-media')?.metadata?.strategy).not.toHaveProperty('config')
    expect(definition('guardrail:dynamic-spread-media')).toMatchObject({
      metadata: { strategy: { kind: 'media' }, facts: { strategy: { kind: 'media' } } },
    })
    expect(definition('guardrail:dynamic-spread-media')?.metadata?.strategy).not.toHaveProperty('config')
    expect(definition('guardrail:pii-text')).toMatchObject({
      metadata: {
        strategy: { kind: 'pii', config: { strategy: 'redact' } },
        facts: { strategy: { kind: 'pii', config: { strategy: 'redact' } } },
      },
    })
    expect(definition('guardrail:local-policy')?.metadata).not.toHaveProperty('strategy')
    expect(definition('guardrail:local-policy')?.metadata?.facts).not.toHaveProperty('strategy')
    expect(definition('guardrail:cyclic-media')).toMatchObject({
      metadata: { strategy: { kind: 'media' }, facts: { strategy: { kind: 'media' } } },
    })
    expect(definition('guardrail:cyclic-media')?.metadata?.strategy).not.toHaveProperty('config')
    expect(definition('guardrail:non-finite-media')).toMatchObject({
      metadata: { strategy: { kind: 'media' }, facts: { strategy: { kind: 'media' } } },
    })
    expect(definition('guardrail:non-finite-media')?.metadata?.strategy).not.toHaveProperty('config')
    expect(definition('constraint:judged')).toMatchObject({
      metadata: { strategy: { kind: 'judge' }, facts: { strategy: { kind: 'judge' } } },
    })
    expect(definition('constraint:judged')?.metadata?.strategy).not.toHaveProperty('config')
    expect(definition('constraint:judged')?.metadata?.facts).not.toHaveProperty('strategy.config')
  }, 30_000)
})
