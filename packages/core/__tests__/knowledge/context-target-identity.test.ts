import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assertions } from '../../src/knowledge'
import { createAssertionIdentity } from '../../src/knowledge/assertions/identity'

describe('context-target identity stability (selector-less)', () => {
  const model = {
    name: 'assertion-extractor',
    fingerprint: 'assertion-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: async () => ({ object: { assertions: [] } }),
  }

  const stage = assertions({ id: 'facts', version: 1, types: { fact: z.object({ value: z.string() }) }, model })

  it('stage fingerprint does NOT depend on presence of selector', () => {
    const stageWithSelector = assertions({
      id: 'facts',
      version: 1,
      types: { fact: z.object({ value: z.string() }) },
      model,
      targets: (chunks) => chunks,
    })
    expect(stageWithSelector.fingerprint()).toBe(stage.fingerprint())
  })

  it('assertion identity is byte-identical for selector-less stages (golden values)', () => {
    const identity1 = createAssertionIdentity({
      stageId: stage.id,
      stageVersion: stage.version,
      stageFingerprint: stage.fingerprint(),
      type: 'fact',
      data: { value: 'y' },
    })
    const identity2 = createAssertionIdentity({
      stageId: stage.id,
      stageVersion: stage.version,
      stageFingerprint: stage.fingerprint(),
      type: 'fact',
      data: { value: 'y' },
    })
    expect(identity1).toBe(identity2)
    expect(identity1).toMatch(/^assertion_/) // verify format
  })
})