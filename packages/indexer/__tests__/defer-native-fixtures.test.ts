import { describe, expect, it } from 'vitest'
import { createStaticExtraction, type SourceReader } from '../src/indexer/static/extraction/engine'
import { createTypeScriptStaticSyntaxFrontend } from '../src/indexer/static-index/syntax'
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('defer native projection', () => {
  it('discovers public defer through the TypeScript syntax frontend', async () => {
    const root = '/fixture'
    const file = '/fixture/src/api.ts'
    const source = [
      "import { defer } from '@use-crux/core'",
      'defer(() => undefined)',
    ].join('\n')
    const sources: SourceReader = {
      read: async (requestedFile) => {
        if (requestedFile !== file) throw new Error(`Unexpected source: ${requestedFile}`)
        return source
      },
    }
    const extraction = createStaticExtraction({
      root,
      sources,
      cache: 'none',
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    })

    const out = await extraction.extractFile(file)
    expect(out.definitions.map((definition) => definition.id)).toContain(
      'deferred-work:inline:src-api.ts:769911c416ccf851:1',
    )
  })

  itWithRustOxc(
    'proves eager scope absence without treating ordinary functions as eager',
    async () => {
      const { nativeOut, typescriptOut } = await extractNativeAndFallback({
        source: [
          "import { defer } from '@use-crux/core'",
          'defer(() => undefined)',
          'class Startup {',
          '  static pending = defer(() => undefined)',
          '}',
          'function handler() {',
          '  defer(() => undefined)',
          '}',
          'const sendEmail = {}',
          'async function batch() {',
          '  await Promise.all([',
          '    defer(sendEmail, { id: 1 })',
          '  ])',
          '}',
        ].join('\n'),
        callNames: ['defer'],
      })

      expect(
        nativeOut.definitions
          .filter((definition) => definition.kind === 'deferred-work')
          .map((definition) => definition.metadata?.eagerExecution),
      ).toEqual([true, true, false, false])
      expect(
        nativeOut.definitions
          .filter((definition) => definition.kind === 'deferred-work')
          .map((definition) => definition.metadata?.consumed),
      ).toEqual([false, false, false, true])
      expectNativeExtractionParity(nativeOut, typescriptOut)
    },
    30_000,
  )

  itWithRustOxc(
    'contains nested deferred work in its replayable flow owner',
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { defer } from '@use-crux/core'",
          "export const sendFlow = flow('send', async () => {",
          '  defer(() => undefined)',
          '})',
        ].join('\n'),
        callNames: ['defer', 'flow'],
      })

      expect(nativeOut.relations).toContainEqual(
        expect.objectContaining({
          type: 'defer.contained_by',
          from: 'deferred-work:inline:src-fixture.ts:be4c7cffd8136a5a:1',
          to: 'flow:send',
        }),
      )
      expect(
        nativeOut.definitions.find(
          (definition) => definition.kind === 'deferred-work',
        )?.metadata,
      ).toMatchObject({ eagerExecution: false })
    },
    30_000,
  )

  itWithRustOxc(
    'assigns stable combined ordinals to binding-resolved public defer calls',
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { defer as afterResponse } from '@use-crux/core'",
          "import { scheduleDiagnosticsOnlyDeferredCallback } from '@use-crux/core/defer/internal/port'",
          "import { durableTask } from '@use-crux/core/runtime'",
          "const sendEmail = durableTask('send-email', { run: async () => undefined })",
          'const flush = () => undefined',
          'afterResponse(() => flush())',
          'await afterResponse(sendEmail, { id: 1 })',
          'await afterResponse(sendEmail, { id: 2 })',
          'const defer = () => undefined',
          'defer()',
          'scheduleDiagnosticsOnlyDeferredCallback(() => undefined)',
        ].join('\n'),
        callNames: ['defer', 'durableTask'],
      })

      expect(
        nativeOut.definitions
          .filter((definition) => definition.kind === 'deferred-work')
          .map((definition) => definition.id),
      ).toEqual([
        'deferred-work:inline:src-fixture.ts:be4c7cffd8136a5a:1',
        'deferred-work:named:src-fixture.ts:be4c7cffd8136a5a:2',
        'deferred-work:named:src-fixture.ts:be4c7cffd8136a5a:3',
      ])
      expect(
        nativeOut.definitions
          .filter((definition) => definition.kind === 'deferred-work')
          .map((definition) => ({
            consumed: definition.metadata?.consumed,
            eagerExecution: definition.metadata?.eagerExecution,
          })),
      ).toEqual([
        { consumed: false, eagerExecution: true },
        { consumed: true, eagerExecution: true },
        { consumed: true, eagerExecution: true },
      ])
      expect(
        nativeOut.relations.filter(
          (relation) => relation.type === 'defer.targets_task',
        ),
      ).toEqual([
        expect.objectContaining({
          from: 'deferred-work:named:src-fixture.ts:be4c7cffd8136a5a:2',
          to: 'task:send-email',
        }),
        expect.objectContaining({
          from: 'deferred-work:named:src-fixture.ts:be4c7cffd8136a5a:3',
          to: 'task:send-email',
        }),
      ])
    },
    30_000,
  )
})
