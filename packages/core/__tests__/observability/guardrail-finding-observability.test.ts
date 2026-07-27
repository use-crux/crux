import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateObjectFn } from '../../src/compaction'
import { createUnsupportedCapabilityError } from '../../src/content'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { boundary, createSafety, guardrail } from '../../src/safety'

afterEach(() => {
  resetObservabilityRuntime()
})

function classifier(generate: GenerateObjectFn, unsupported?: 'allow') {
  return guardrail({
    id: 'observed-media-classifier',
    on: boundary.input.media(),
    mode: 'report',
    run: guardrail.mediaClassifier({
      generate,
      model: 'private-classifier-model',
      categories: [{
        id: 'secret-category-id',
        description: 'SECRET_CATEGORY_DESCRIPTION',
      }],
      threshold: 0.812468,
      ...(unsupported ? { unsupported } : {}),
    }),
  })
}

async function guardOneFile(generate: GenerateObjectFn, unsupported?: 'allow') {
  const transport = createInMemoryObservabilityTransport()
  setObservabilityTransport(transport, { scheduledDelayMs: 0 })
  const safety = createSafety({
    promptId: 'finding-observability',
    model: 'protected-model',
    call: { guardrails: [classifier(generate, unsupported)] },
  })

  await safety.guardInput({
    messages: [{
      role: 'user',
      content: [{
        type: 'file',
        source: 'https://private.example/SECRET_MEDIA_URL.pdf',
        filename: 'SECRET_FILENAME.pdf',
        providerOptions: {
          private: { fileId: 'SECRET_PROVIDER_FILE_ID' },
        },
      }],
    }],
  })
  await observe.flush()
  return { safety, records: transport.records }
}

describe('guardrail finding observability', () => {
  it('keeps classifier evidence in audit/artifact and only counts in telemetry', async () => {
    const generate: GenerateObjectFn = async (options) => ({
      object: options.schema.parse({
        scores: { 'secret-category-id': 0.913579 },
      }),
    })

    const { safety, records } = await guardOneFile(generate)
    const finding = {
      type: 'media_classifier_match',
      category: 'secret-category-id',
      score: 0.913579,
      threshold: 0.812468,
    }
    expect(safety.audit.guardrails?.applied[0]?.findings).toEqual([finding])
    expect(records).toContainEqual(expect.objectContaining({
      type: 'artifact',
      kind: 'guardrail.report',
      preview: expect.objectContaining({ findings: [finding] }),
      attributes: expect.objectContaining({
        findingCount: 1,
        matchedCategoryCount: 1,
      }),
    }))
    expect(records).toContainEqual(expect.objectContaining({
      type: 'span:event',
      name: 'guardrail.action',
      attributes: expect.objectContaining({
        findingCount: 1,
        matchedCategoryCount: 1,
      }),
    }))

    const telemetry = records.filter((record) => record.type !== 'artifact')
    const serialized = JSON.stringify(telemetry)
    for (const secret of [
      'secret-category-id',
      '0.913579',
      '0.812468',
      'SECRET_CATEGORY_DESCRIPTION',
      'SECRET_MEDIA_URL',
      'SECRET_FILENAME',
      'SECRET_PROVIDER_FILE_ID',
      'private-classifier-model',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('keeps unsupported allow visible without fabricated score evidence', async () => {
    const error = createUnsupportedCapabilityError({
      adapter: 'classifier-adapter',
      model: 'classifier-model',
      issues: [{ capability: 'input.file' }],
    })
    const generate: GenerateObjectFn = async () => {
      throw error
    }

    const { safety, records } = await guardOneFile(generate, 'allow')
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      action: 'allow',
      findings: [{ type: 'media_not_inspected' }],
    })
    expect(records).toContainEqual(expect.objectContaining({
      type: 'artifact',
      kind: 'guardrail.report',
      preview: expect.objectContaining({
        action: 'allow',
        findings: [{ type: 'media_not_inspected' }],
      }),
      attributes: expect.objectContaining({
        findingCount: 1,
        matchedCategoryCount: 0,
      }),
    }))
  })
})
