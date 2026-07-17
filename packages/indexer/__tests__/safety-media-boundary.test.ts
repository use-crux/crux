import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('input media safety boundary indexing', () => {
  itWithRustOxc(
    'extracts the exact media target and callback source through the native contract',
    async () => {
      const { nativeOut, record } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          '',
          'function inspectUpload() {',
          "  return { action: 'allow' as const }",
          '}',
          '',
          'export const mediaUpload = guardrail({',
          "  id: 'media-upload',",
          '  on: boundary.input.media(),',
          '  run: inspectUpload,',
          '})',
        ].join('\n'),
        callNames: ['guardrail', 'media'],
      })

      const definition = nativeOut.definitions.find(
        (candidate) => candidate.id === 'guardrail:media-upload',
      )
      expect(definition).toMatchObject({
        kind: 'guardrail',
        name: 'media-upload',
        metadata: {
          boundary: 'user.input.media',
          boundaries: ['user.input.media'],
          facts: {
            kind: 'guardrail',
            policyId: 'media-upload',
            boundary: 'user.input.media',
            boundaries: ['user.input.media'],
          },
        },
      })
      expect(definition?.sourceRefs).toContainEqual(
        expect.objectContaining({
          property: 'run',
          role: 'policy',
          symbol: 'inspectUpload',
        }),
      )
      expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toContainEqual({
        extension: '@use-crux/indexer/crux-core',
        extractor: 'safety',
      })
    },
    30_000,
  )
})
