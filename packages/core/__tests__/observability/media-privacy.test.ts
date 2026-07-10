import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from '../../src/observability'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'

describe('observability media privacy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it.each([undefined, 'full', 'safe'] as const)(
    'sanitizes every media locator and payload under %s capture',
    async (capture) => {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport, { scheduledDelayMs: 0 })
      if (capture) updateHooks({ observabilityCapture: { capture } })
      const namedBlob = Object.assign(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }), {
        name: 'SECRET_BLOB_FILENAME.png',
      })

      await observe.span({ name: 'generate', primitive: 'generation.call' }, async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            content: [
              {
                type: 'image',
                source: 'https://SECRET_USER:SECRET_PASSWORD@example.com/a.png?SECRET_QUERY#SECRET_FRAGMENT',
                mediaType: 'image/png',
              },
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: new URL('https://example.com/SECRET_PATH?SECRET_ASSET_QUERY'),
                  mediaType: 'image/png',
                },
              },
              {
                type: 'file',
                source: { type: 'provider-file', provider: 'openai', fileId: 'SECRET_PROVIDER_FILE_ID' },
                filename: 'SECRET_PROVIDER_FILENAME.pdf',
              },
              { type: 'image', source: 'data:image/png;base64,SECRET_DATA_URL', mediaType: 'image/png' },
              { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
              { type: 'image', source: namedBlob, mediaType: 'image/png' },
              {
                type: 'file',
                source: {
                  type: 'asset-ref',
                  ref: { uri: 'asset://SECRET_ASSET_REF' },
                  mediaType: 'application/pdf',
                },
                mediaType: 'application/pdf',
                filename: 'SECRET_REF_FILENAME.pdf',
              },
            ],
          },
        })
      })
      await observe.flush()

      const output = findArtifact(transport.records, 'output')
      const serialized = JSON.stringify(output)
      for (const sentinel of [
        'SECRET_USER',
        'SECRET_PASSWORD',
        'SECRET_QUERY',
        'SECRET_FRAGMENT',
        'SECRET_PATH',
        'SECRET_ASSET_QUERY',
        'SECRET_PROVIDER_FILE_ID',
        'SECRET_PROVIDER_FILENAME',
        'SECRET_DATA_URL',
        'SECRET_BLOB_FILENAME',
        'SECRET_ASSET_REF',
        'SECRET_REF_FILENAME',
      ])
        expect(serialized).not.toContain(sentinel)
      const content = (output?.preview as { content: readonly Record<string, unknown>[] }).content
      expect(content).toHaveLength(7)
      expect(content.every((part) => typeof part.source === 'string')).toBe(true)
      expect(content.every((part) => !('filename' in part))).toBe(true)
    },
  )
})

function findArtifact(
  records: readonly CruxGraphRecord[],
  kind: string,
): Extract<CruxGraphRecord, { readonly type: 'artifact' }> | undefined {
  return records.find(
    (record): record is Extract<CruxGraphRecord, { readonly type: 'artifact' }> =>
      record.type === 'artifact' && record.kind === kind,
  )
}
