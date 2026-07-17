/** Safe observability records for input media guardrail decisions. */

import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { boundary, createSafety, guardrail, GuardrailBlockedError, type MediaPart } from '../../src/safety'

describe('input media safety observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records a media strip with exact safe binding and location metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const source = 'https://example.com/SECRET_MEDIA_PATH.png?SECRET_QUERY=yes'
    const strip = guardrail({
      id: 'strip-observed-image',
      on: boundary.input.media(),
      run: () => ({ action: 'strip', reason: 'Image is outside policy.' }),
    })
    const safety = createSafety({
      call: { guardrails: [strip] },
      promptId: 'media-observability',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Keep this.' },
            { type: 'image', source, mediaType: 'image/png' },
          ],
        },
      ],
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'guardrail.run',
        name: 'strip-observed-image',
        attributes: expect.objectContaining({
          boundary: 'user.input.media',
          mode: 'enforce',
          mediaPartType: 'image',
          messageIndex: 0,
          partIndex: 1,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'guardrail.report',
        attributes: expect.objectContaining({
          guardrailName: 'strip-observed-image',
          boundary: 'user.input.media',
          mode: 'enforce',
          action: 'strip',
          mediaPartType: 'image',
          messageIndex: 0,
          partIndex: 1,
        }),
        preview: {
          kind: 'guardrail.report',
          phase: 'input',
          action: 'strip',
          reason: 'Image is outside policy.',
          mediaPartType: 'image',
          messageIndex: 0,
          partIndex: 1,
        },
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'guardrail.action',
        attributes: expect.objectContaining({
          guardrailName: 'strip-observed-image',
          action: 'strip',
          mediaPartType: 'image',
          messageIndex: 0,
          partIndex: 1,
        }),
      }),
    )
    const serialized = JSON.stringify(transport.records)
    expect(serialized).not.toContain('SECRET_MEDIA_PATH')
    expect(serialized).not.toContain('SECRET_QUERY')
  })

  it('records strip-to-empty before the blocked edge with one callback and one location', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    let callbacks = 0
    const strip = guardrail({
      id: 'strip-only-observed-part',
      on: boundary.input.media(),
      run: () => {
        callbacks++
        return { action: 'strip', reason: 'Only image is outside policy.' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [strip] },
      promptId: 'media-observability',
      model: 'model-1',
    })

    const error = await safety
      .guardInput({
        messages: [
          { role: 'system', content: 'System.' },
          { role: 'user', content: [{ type: 'image', source: new Uint8Array([83, 69, 67, 82, 69, 84]) }] },
        ],
      })
      .then(() => undefined)
      .catch((caught: unknown) => caught)
    await observe.flush()

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]).toMatchObject({
      policyId: 'strip-only-observed-part',
      boundary: 'user.input.media',
      action: 'block',
      reason: 'Only image is outside policy.',
      location: { messageIndex: 1, partIndex: 0, partType: 'image' },
    })
    expect(callbacks).toBe(1)

    const reportIndex = transport.records.findIndex(
      (record) => record.type === 'artifact' && record.kind === 'guardrail.report' && record.preview?.action === 'strip',
    )
    const actionIndex = transport.records.findIndex(
      (record) => record.type === 'span:event' && record.name === 'guardrail.action',
    )
    const blockedIndex = transport.records.findIndex(
      (record) => record.type === 'edge' && record.edgeType === 'guardrail.blocked',
    )
    expect([reportIndex, actionIndex, blockedIndex]).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
    expect(reportIndex).toBeGreaterThanOrEqual(0)
    expect(actionIndex).toBeGreaterThan(reportIndex)
    expect(blockedIndex).toBeGreaterThan(actionIndex)
    expect(transport.records[reportIndex]).toMatchObject({
      preview: {
        action: 'strip',
        escalatedToBlock: true,
        mediaPartType: 'image',
        messageIndex: 1,
        partIndex: 0,
      },
    })
    expect(
      transport.records.filter((record) => record.type === 'span:event' && record.name === 'guardrail.action'),
    ).toHaveLength(1)
    expect(JSON.stringify(transport.records)).not.toContain('83,69,67,82,69,84')
  })

  it('never serializes URL, data URL, byte, Blob, or Asset-shaped media sources', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const namedBlob = Object.assign(new Blob([new Uint8Array([211, 212, 213])]), {
      name: 'SECRET_BLOB_NAME.png',
    })
    const cases: readonly MediaPart[] = [
      { type: 'image', source: 'https://example.com/SECRET_URL_PATH.png?SECRET_URL_QUERY=yes' },
      { type: 'image', source: 'data:image/png;base64,SECRET_DATA_URL_PAYLOAD' },
      { type: 'image', source: new Uint8Array([201, 202, 203, 204]) },
      { type: 'image', source: namedBlob },
      {
        type: 'file',
        source: {
          type: 'provider-file',
          provider: 'mock',
          fileId: 'SECRET_PROVIDER_FILE_ID',
          filename: 'SECRET_ASSET_FILENAME.pdf',
        },
        filename: 'SECRET_PART_FILENAME.pdf',
        providerOptions: { mock: { locator: 'SECRET_PROVIDER_OPTION' } },
      },
    ]

    for (const [index, media] of cases.entries()) {
      const report = guardrail({
        id: `safe-media-source-${index}`,
        on: boundary.input.media(),
        mode: 'report',
        run: () => ({ action: 'strip', reason: 'Would strip media.' }),
      })
      const safety = createSafety({
        call: { guardrails: [report] },
        promptId: 'media-privacy',
        model: 'model-1',
      })
      await safety.guardInput({
        messages: [{ role: 'user', content: [media] }],
      })
    }
    await observe.flush()

    const serialized = JSON.stringify(transport.records)
    for (const sentinel of [
      'SECRET_URL_PATH',
      'SECRET_URL_QUERY',
      'SECRET_DATA_URL_PAYLOAD',
      'SECRET_BLOB_NAME',
      'SECRET_PROVIDER_FILE_ID',
      'SECRET_ASSET_FILENAME',
      'SECRET_PART_FILENAME',
      'SECRET_PROVIDER_OPTION',
      '\"0\":201,\"1\":202,\"2\":203,\"3\":204',
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(transport.records.filter((record) => record.type === 'artifact')).toHaveLength(cases.length)
    const reportActions = transport.records.filter(
      (record) => record.type === 'span:event' && record.name === 'guardrail.action',
    )
    expect(reportActions).toHaveLength(cases.length)
    for (const action of reportActions) {
      expect(action.attributes).toMatchObject({
        boundary: 'user.input.media',
        mode: 'report',
        action: 'strip',
      })
    }
  })

  it('keeps composite source-policy URL facts out of observability', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const source = 'https://SECRET_USER:SECRET_PASSWORD@secret-host.invalid/SECRET_PATH?SECRET_QUERY=yes'
    const policy = guardrail({
      id: 'private-composite-media-policy',
      on: boundary.input.media(),
      mode: 'report',
      run: guardrail.media({
        sources: {
          allowHosts: ['cdn.example.com'],
          allowUrlQuery: false,
        },
      }),
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'media-privacy',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [{ role: 'user', content: [{ type: 'image', source }] }],
    })
    await observe.flush()

    const serialized = JSON.stringify({ audit: safety.audit, records: transport.records })
    for (const sentinel of [
      source,
      'SECRET_USER',
      'SECRET_PASSWORD',
      'secret-host.invalid',
      'SECRET_PATH',
      'SECRET_QUERY',
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(serialized).toContain('media source host is not allowed')
    expect(serialized).toContain('media source URL userinfo is not allowed')
    expect(serialized).toContain('media source URL query strings are not allowed')
  })
})
