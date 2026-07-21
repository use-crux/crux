import { describe, expect, it } from 'vitest'
import { createTypeScriptStaticSyntaxFrontend } from '../src/indexer/static-index/syntax'
import type { StaticSyntaxFileRecord, StaticSyntaxValue } from '../src/indexer/static-index/syntax'
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('semantic model-input boundary indexing', () => {
  const source = [
    "import { boundary, guardrail } from '@use-crux/core/safety'",
    '',
    'export const toolText = guardrail({',
    "  id: 'tool-text',",
    "  on: boundary.input.text({ from: 'tool' }),",
    "  run: () => ({ action: 'allow' as const }),",
    '})',
  ].join('\n')

  it('retains option-bearing boundary syntax in the TypeScript evidence record', async () => {
    const record = await createTypeScriptStaticSyntaxFrontend({
      callNames: ['guardrail'],
    }).parseFile({
      root: '/repo',
      file: '/repo/src/safety.ts',
      source,
    })

    const match = record.matches[0]
    const on = match?.kind === 'call'
      ? match.objectArg?.properties.find((property) => property.name === 'on')
      : undefined
    expect(on?.value).toMatchObject({
      kind: 'call',
      callee: expect.objectContaining({ name: 'text' }),
      args: [
        expect.objectContaining({
          kind: 'object',
          properties: [
            expect.objectContaining({
              name: 'from',
              value: { kind: 'literal', value: 'tool' },
            }),
          ],
        }),
      ],
    })
  })

  itWithRustOxc(
    'projects an option-bearing text helper to the canonical boundary',
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source,
        callNames: ['guardrail'],
      })

      const definition = nativeOut.definitions.find(
        (candidate) => candidate.id === 'guardrail:tool-text',
      )
      expect(definition).toMatchObject({
        metadata: {
          boundary: 'model.input.text',
          boundaries: ['model.input.text'],
          facts: {
            boundary: 'model.input.text',
            boundaries: ['model.input.text'],
          },
        },
      })
      expect(definition?.metadata).not.toHaveProperty('from')
      expect(definition?.metadata?.facts).not.toHaveProperty('from')
    },
    90_000,
  )

  itWithRustOxc(
    'keeps option-bearing helper evidence equivalent across TypeScript and Rust/Oxc',
    async () => {
      const { record } = await extractNativeAndFallback({ source, callNames: ['guardrail'] })
      const typescript = await createTypeScriptStaticSyntaxFrontend({
        callNames: ['guardrail'],
      }).parseFile({
        root: '/repo',
        file: '/repo/src/safety.ts',
        source,
      })

      expect(boundaryEvidence(record)).toEqual(boundaryEvidence(typescript))
      expect(boundaryEvidence(record)).toEqual({
        helper: 'text',
        receiver: ['boundary', 'input'],
        from: 'tool',
      })
    },
    90_000,
  )

  itWithRustOxc(
    'projects all semantic input helpers without storing scalar or tuple selectors',
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          '',
          'export const allIngress = guardrail({',
          "  id: 'all-ingress',",
          '  on: [',
          "    boundary.input.text({ from: ['tool', 'retrieval'] as const }),",
          "    boundary.input.media({ from: ['user', 'tool'] as const }),",
          '    boundary.input.instructions(),',
          '  ] as const,',
          "  run: () => ({ action: 'allow' as const }),",
          '})',
        ].join('\n'),
        callNames: ['guardrail'],
      })

      const definition = nativeOut.definitions.find(
        (candidate) => candidate.id === 'guardrail:all-ingress',
      )
      expect(definition).toMatchObject({
        metadata: {
          boundary: 'model.input.text',
          boundaries: [
            'model.input.text',
            'model.input.media',
            'model.instructions',
          ],
          facts: {
            boundary: 'model.input.text',
            boundaries: [
              'model.input.text',
              'model.input.media',
              'model.instructions',
            ],
          },
        },
      })
      expect(JSON.stringify(definition?.metadata)).not.toContain('"from"')
      expect(JSON.stringify(definition?.metadata)).not.toContain('retrieval')
    },
    90_000,
  )

  itWithRustOxc(
    'does not recognize removed lifecycle-shaped helpers as boundary definitions',
    async () => {
      const removed = [
        'boundary.input.user()',
        'boundary.input.model()',
        'boundary.tool.call()',
        'boundary.tool.result()',
        'boundary.approval.request()',
        'boundary.retrieval.result()',
      ]
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          '',
          ...removed.flatMap((helper, index) => [
            `export const removed${index} = guardrail({`,
            `  id: 'removed-${index}',`,
            `  on: ${helper},`,
            "  run: () => ({ action: 'allow' as const }),",
            '})',
          ]),
        ].join('\n'),
        callNames: ['guardrail'],
      })

      const definitions = nativeOut.definitions.filter((definition) =>
        definition.id.startsWith('guardrail:removed-'),
      )
      expect(definitions).toHaveLength(removed.length)
      for (const definition of definitions) {
        expect(definition.metadata).not.toHaveProperty('boundary')
        expect(definition.metadata).not.toHaveProperty('boundaries')
        expect(definition.metadata?.facts).not.toHaveProperty('boundary')
        expect(definition.metadata?.facts).not.toHaveProperty('boundaries')
      }
    },
    90_000,
  )
})

function boundaryEvidence(record: StaticSyntaxFileRecord): {
  readonly helper: string
  readonly receiver: readonly string[]
  readonly from?: string
} {
  const match = record.matches[0]
  const value = match?.kind === 'call'
    ? match.objectArg?.properties.find((property) => property.name === 'on')?.value
    : undefined
  if (!value || value.kind !== 'call') throw new Error('Expected an option-bearing boundary call.')
  const receiver = value.receiver?.kind === 'property-access' ? value.receiver.path : []
  return {
    helper: value.callee.name,
    receiver,
    ...literalFrom(value.args[0]),
  }
}

function literalFrom(value: StaticSyntaxValue | undefined): { readonly from?: string } {
  if (!value || value.kind !== 'object') return {}
  const from = value.properties.find((property) => property.name === 'from')?.value
  return from?.kind === 'literal' && typeof from.value === 'string'
    ? { from: from.value }
    : {}
}
