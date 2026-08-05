import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { z } from 'zod'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import type { CruxChunk, CruxDocument } from '../../src/indexing/types'
import { assertions, knowledgeModel, type KnowledgeContentPart, type KnowledgeModel } from '../../src/knowledge'
import { MAX_DERIVE_BATCH_CHARS } from '../../src/knowledge/derive/bounds'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { selectTargetChunks } from '../../src/knowledge/derive/target-selection'
import { inMemoryAssetStore, inMemoryRecordStore } from '../../src/storage'

const namespace = 'context-target'
const sourceId = 'doc-1'
const assertionTypes = {
  fact: z.object({ value: z.string() }),
}

describe('connected knowledge context vs target chunks', () => {
  it('renders role labels for context chunks and pins the evidence schema to targets only', async () => {
    const prompts: string[] = []
    const schemas: z.ZodType<unknown>[] = []
    const model = assertionModel(prompts, schemas)
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    expect(prompts[0]).toContain('[TARGET:] [doc-1/c1] alpha')
    expect(prompts[0]).toContain('[CONTEXT:] [doc-1/c2] beta')

    const schema = schemas[0]!
    expect(schema.safeParse({
      assertions: [{ type: 'fact', data: { value: 'x' }, evidence: [chunkRef('c1')] }],
    }).success).toBe(true)
    expect(schema.safeParse({
      assertions: [{ type: 'fact', data: { value: 'x' }, evidence: [chunkRef('c2')] }],
    }).success).toBe(false)
  })

  it('deterministic run rejects evidence pointing at a context-only chunk', async () => {
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
      run: (_input, api) => {
        api.emit('fact', { value: 'from-context' }, { evidence: chunkRef('c2') })
      },
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })).rejects.toThrow(/invalid evidence — context-only chunk/)
  })

  it('deterministic run accepts evidence pointing at a target chunk', async () => {
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
      run: (_input, api) => {
        api.emit('fact', { value: 'from-target' }, { evidence: chunkRef('c1') })
      },
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    expect(result).toEqual([{ stageId: 'facts', status: 'ran', claims: 1, warnings: [] }])
  })

  it('generated context-only citation repairs once then exhausts with context_only_evidence', async () => {
    const prompts: string[] = []
    const invalid = {
      assertions: [{ type: 'fact', data: { value: 'x' }, evidence: [chunkRef('c2')] }],
    }
    const model = fixedAssertionModel([invalid, invalid], prompts)
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    const error = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(model.generateObject).toHaveBeenCalledTimes(2)
    // The authored diagnostic reaches the repair prompt so the model can self-correct.
    expect(prompts[1]).toContain('evidence may only reference target chunks')
    // The ultimate error surfaces the stable content-safe code.
    expect((error as ValidationExhaustedError).issues).toEqual([
      { path: 'assertions.[0].evidence.[0]', depth: 4, code: 'context_only_evidence' },
    ])
  })

  it('generated citation of a target chunk passes validation', async () => {
    const prompts: string[] = []
    const model = fixedAssertionModel([
      { assertions: [{ type: 'fact', data: { value: 'x' }, evidence: [chunkRef('c1')] }] },
    ], prompts)
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    expect(result[0]?.claims).toBe(1)
    expect(model.generateObject).toHaveBeenCalledTimes(1)
  })

  it('assertion relations reject evidence pointing at a context-only chunk', async () => {
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'c1'),
      run: (_input, api) => {
        const first = api.emit('fact', { value: 'one' }, { evidence: chunkRef('c1') })
        const second = api.emit('fact', { value: 'two' }, { evidence: chunkRef('c1') })
        api.relate('supports', first, second, { evidence: chunkRef('c2') })
      },
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })).rejects.toThrow(/relation supports: invalid evidence — context-only chunk/)
  })

  it('keeps context visible with its target, emits each target once, and repeats shared context', async () => {
    const prompts: string[] = []
    const model = assertionModel(prompts, [])
    // Chunks: [c1, t1, c2, t2, c3] — targets t1, t2; context c1, c2, c3.
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 't1' || chunk.chunkId === 't2'),
    })
    const sourceChunks = [
      chunk('c1', 0, 'ctx-one'),
      chunk('t1', 1, 'target-one'),
      chunk('c2', 2, 'ctx-two'),
      chunk('t2', 3, 'target-two'),
      chunk('c3', 4, 'ctx-three'),
    ]

    await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    // Two targets => two batches.
    expect(model.generateObject).toHaveBeenCalledTimes(2)
    expect(prompts).toHaveLength(2)

    // Batch 1 (t1): target t1 + nearest context c1, c2; not c3.
    expect(prompts[0]).toContain('[TARGET:] [doc-1/t1]')
    expect(prompts[0]).toContain('[CONTEXT:] [doc-1/c1]')
    expect(prompts[0]).toContain('[CONTEXT:] [doc-1/c2]')
    expect(prompts[0]).not.toContain('[doc-1/c3]')
    expect(prompts[0]).not.toContain('[doc-1/t2]')

    // Batch 2 (t2): target t2 + nearest context c2, c3; not c1.
    expect(prompts[1]).toContain('[TARGET:] [doc-1/t2]')
    expect(prompts[1]).toContain('[CONTEXT:] [doc-1/c2]')
    expect(prompts[1]).toContain('[CONTEXT:] [doc-1/c3]')
    expect(prompts[1]).not.toContain('[doc-1/c1]')
    expect(prompts[1]).not.toContain('[doc-1/t1]')

    // Each target appears exactly once across all batches (as a TARGET label).
    const allPrompts = prompts.join('\n')
    expect(allPrompts.match(/\[TARGET:\] \[doc-1\/t1\]/g)).toHaveLength(1)
    expect(allPrompts.match(/\[TARGET:\] \[doc-1\/t2\]/g)).toHaveLength(1)
    // Shared context c2 repeats across both batches.
    expect(allPrompts.match(/\[CONTEXT:\] \[doc-1\/c2\]/g)).toHaveLength(2)
  })

  it('produces identical batches regardless of mixed-role chunk input order (property)', async () => {
    // fc: shuffle a fixed mixed-role chunk set; prompts must be identical.
    const sourceChunks = [
      chunk('c1', 0, 'ctx-one'),
      chunk('t1', 1, 'target-one'),
      chunk('c2', 2, 'ctx-two'),
      chunk('t2', 3, 'target-two'),
      chunk('c3', 4, 'ctx-three'),
    ]
    const isTarget = (id: string) => id === 't1' || id === 't2'

    const baseline = await runMixedRole(sourceChunks, isTarget)

    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(sourceChunks, { minLength: sourceChunks.length, maxLength: sourceChunks.length }), async (shuffled) => {
        const result = await runMixedRole(shuffled, isTarget)
        expect(result).toEqual(baseline)
      }),
      { numRuns: 25 },
    )
  })

  it('drops the farthest context chunk with a distinct warning when the batch overflows', async () => {
    const prompts: string[] = []
    const model = assertionModel(prompts, [])
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 't1'),
    })
    // t1 + c1 fits; adding c2 overflows the batch budget.
    const nearSize = Math.floor(MAX_DERIVE_BATCH_CHARS / 2) + 500
    const sourceChunks = [
      chunk('t1', 0, sizedContent(100, 'target')),
      chunk('c1', 1, sizedContent(nearSize, 'near-context')),
      chunk('c2', 2, sizedContent(nearSize, 'far-context')),
    ]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    // One target => one batch; the farthest context chunk is dropped.
    expect(model.generateObject).toHaveBeenCalledTimes(1)
    expect(prompts[0]).toContain('[TARGET:] [doc-1/t1]')
    expect(prompts[0]).toContain('near-context')
    expect(prompts[0]).not.toContain('far-context')

    // The drop surfaces a distinct warning, never the truncation template.
    const warnings = result[0]?.warnings ?? []
    expect(warnings.some((warning) => /dropped context chunk/.test(warning))).toBe(true)
    expect(warnings.some((warning) => /truncated chunk/.test(warning))).toBe(false)
    expect(warnings.find((warning) => /dropped context chunk/.test(warning))).toContain('c2')
  })

  it('truncates an oversized target chunk and preserves its target role for evidence', async () => {
    const prompts: string[] = []
    // Model cites the (truncated) target chunk t1 — must remain admissible evidence.
    const model = fixedAssertionModel([
      { assertions: [{ type: 'fact', data: { value: 'x' }, evidence: [chunkRef('t1')] }] },
    ], prompts)
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 't1'),
    })
    const huge = `HUGE_START ${'x'.repeat(MAX_DERIVE_BATCH_CHARS + 1000)} HUGE_END`
    const sourceChunks = [chunk('t1', 0, huge), chunk('c1', 1, 'small-context')]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    // The oversized target is truncated, not dropped, and stays citable.
    expect(result[0]?.claims).toBe(1)
    expect(prompts[0]).toContain('HUGE_START')
    expect(prompts[0]).not.toContain('HUGE_END')
    const warnings = result[0]?.warnings ?? []
    expect(warnings.some((warning) => /truncated chunk/.test(warning))).toBe(true)
  })

  it('reuses the cache across runs and invalidates only the stage whose roles changed', async () => {
    const records = inMemoryRecordStore()
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]
    const selectC1 = (chunks: readonly CruxChunk[]) => chunks.filter((c) => c.chunkId === 'c1')
    const selectC2 = (chunks: readonly CruxChunk[]) => chunks.filter((c) => c.chunkId === 'c2')
    const modelA = fixedAssertionModel([{ assertions: [] }])
    const modelB = fixedAssertionModel([{ assertions: [] }])
    const stageA = (targets: (chunks: readonly CruxChunk[]) => readonly CruxChunk[]) =>
      assertions({ id: 'facts-a', version: 1, types: assertionTypes, model: modelA, targets })
    const stageB = assertions({ id: 'facts-b', version: 1, types: assertionTypes, model: modelB, targets: selectC1 })
    const baseArgs = { records, indexerId: 'kb' as const, namespace, document: document(), chunks: sourceChunks }

    // First run: both stages generate.
    await runDeriveStages({ ...baseArgs, stages: [stageA(selectC1), stageB] })
    expect(modelA.generateObject).toHaveBeenCalledTimes(1)
    expect(modelB.generateObject).toHaveBeenCalledTimes(1)

    // Second run, unchanged roles: both stages hit the cache.
    await runDeriveStages({ ...baseArgs, stages: [stageA(selectC1), stageB] })
    expect(modelA.generateObject).toHaveBeenCalledTimes(1)
    expect(modelB.generateObject).toHaveBeenCalledTimes(1)

    // Flip stage A's selection (c1 target -> context, c2 context -> target).
    // Stage A regenerates; stage B stays cached (cross-stage isolation).
    await runDeriveStages({ ...baseArgs, stages: [stageA(selectC2), stageB] })
    expect(modelA.generateObject).toHaveBeenCalledTimes(2)
    expect(modelB.generateObject).toHaveBeenCalledTimes(1)
  })

  it('skips generation with a warning when the selector yields no target chunks (model mode)', async () => {
    const model = fixedAssertionModel([{ assertions: [] }])
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: () => [],
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    expect(model.generateObject).not.toHaveBeenCalled()
    expect(result[0]?.claims).toBe(0)
    expect(result[0]?.warnings.some((warning) => /no target chunks/.test(warning))).toBe(true)
  })

  it('fails target validation for run-mode claims when the selector yields no targets', async () => {
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      targets: () => [],
      run: (_input, api) => {
        api.emit('fact', { value: 'x' }, { evidence: chunkRef('c1') })
      },
    })
    const sourceChunks = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })).rejects.toThrow(/invalid evidence — context-only chunk/)
  })

  it('renders renderable context media through content parts with a non-evidence label', async () => {
    const assets = inMemoryAssetStore()
    const stored = await assets.put({ type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' })
    const partLabels: string[] = []
    const generateObjectFromParts = vi.fn(async (args: { readonly parts: readonly KnowledgeContentPart[] }) => {
      for (const part of args.parts) {
        if (part.kind === 'text') partLabels.push(part.text)
      }
      return { object: { assertions: [] } }
    })
    const model = knowledgeModel({
      name: 'media-assertions',
      version: '1',
      modalities: ['text', 'image'],
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject: vi.fn(async () => ({ object: { assertions: [] } })),
      generateObjectFromParts,
    })
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 't1'),
    })
    const sourceChunks = [chunk('t1', 0, 'alpha'), mediaChunk('m1', 1, stored.ref)]

    await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
      assets,
    })

    expect(generateObjectFromParts).toHaveBeenCalledTimes(1)
    // Context media renders with the non-evidence "Media:" label, not "Media evidence:".
    expect(partLabels.some((text) => text === 'Media: doc-1/m1')).toBe(true)
    expect(partLabels.some((text) => text.includes('Media evidence: doc-1/m1'))).toBe(false)
  })

  it('drops unrenderable context media with a warning instead of throwing', async () => {
    // Text-only model (no generateObjectFromParts) cannot render the image context chunk.
    const model = knowledgeModel({
      name: 'text-only',
      version: '1',
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject: vi.fn(async () => ({ object: { assertions: [] } })),
    })
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 't1'),
    })
    const sourceChunks = [chunk('t1', 0, 'alpha'), mediaChunk('m1', 1)]

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })

    const warnings = result[0]?.warnings ?? []
    expect(warnings.some((warning) => /dropped context media chunk/.test(warning))).toBe(true)
    expect(warnings.find((warning) => /dropped context media chunk/.test(warning))).toContain('m1')
  })

  it('keeps target media fail-closed when the model cannot render it', async () => {
    const model = knowledgeModel({
      name: 'text-only',
      version: '1',
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject: vi.fn(async () => ({ object: { assertions: [] } })),
    })
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model,
      targets: (chunks) => chunks.filter((chunk) => chunk.chunkId === 'm1'),
    })
    const sourceChunks = [chunk('t1', 0, 'alpha'), mediaChunk('m1', 1)]

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: sourceChunks,
    })).rejects.toThrow(/cannot cover media-only evidence/)
  })

  it('throws when the selector returns a chunk outside the visible set', async () => {
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: assertionTypes,
      model: fixedAssertionModel([{ assertions: [] }]),
      targets: () => [chunk('nope', 99, 'ghost')],
    })
    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: [chunk('c1', 0, 'alpha')],
    })).rejects.toThrow(/not in the source chunk set/)
  })

  it('matches selector results by chunk identity (dedupe + ID, not reference)', () => {
    const visible = [chunk('c1', 0, 'alpha'), chunk('c2', 1, 'beta')]
    // Selector returns fresh objects (different references/content) plus a duplicate.
    const selection = selectTargetChunks(visible, () => [
      { namespace, sourceId, chunkId: 'c1', ordinal: 999, content: 'DIFFERENT', metadata: {} },
      { namespace, sourceId, chunkId: 'c1', ordinal: 0, content: 'alpha', metadata: {} },
    ])

    expect(selection.targetChunks).toHaveLength(1)
    expect(selection.targetKeys.size).toBe(1)
    // Matched back to the ORIGINAL visible chunk, not the selector's copy.
    expect(selection.targetChunks[0]?.content).toBe('alpha')
    expect(selection.targetChunks[0]?.ordinal).toBe(0)
  })
})

async function runMixedRole(
  chunks: readonly CruxChunk[],
  isTarget: (chunkId: string) => boolean,
): Promise<readonly string[]> {
  const prompts: string[] = []
  const model = assertionModel(prompts, [])
  const stage = assertions({
    id: 'facts',
    version: 1,
    types: assertionTypes,
    model,
    targets: (all) => all.filter((c) => isTarget(c.chunkId)),
  })
  await runDeriveStages({
    records: inMemoryRecordStore(),
    indexerId: 'kb',
    namespace,
    stages: [stage],
    document: document(),
    chunks,
  })
  return prompts
}

function assertionModel(prompts: string[], schemas: z.ZodType<unknown>[]): KnowledgeModel {
  return {
    name: 'assertion-extractor',
    fingerprint: 'assertion-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ prompt, schema }) => {
      prompts.push(prompt)
      schemas.push(schema)
      return { object: { assertions: [] } }
    }),
  }
}

function fixedAssertionModel(objects: readonly unknown[], prompts: string[] = []): KnowledgeModel {
  let index = 0
  return {
    name: 'assertion-extractor',
    fingerprint: 'assertion-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ prompt }) => {
      prompts.push(prompt)
      return { object: objects[index++] ?? { assertions: [] } }
    }),
  }
}

function document(): CruxDocument {
  return { namespace, sourceId, title: 'Doc One', content: 'document body', metadata: {} }
}

function chunk(chunkId: string, ordinal: number, content: string): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal, content, metadata: {} }
}

function chunkRef(chunkId: string) {
  return { kind: 'chunk' as const, sourceId, chunkId }
}

function mediaChunk(chunkId: string, ordinal: number, assetRef?: { readonly uri: string }): CruxChunk {
  return {
    ...chunk(chunkId, ordinal, ''),
    source: { mediaType: 'image/png', ...(assetRef ? { assetRef } : {}) },
  }
}

function sizedContent(size: number, marker: string): string {
  return `${marker}|${'x'.repeat(Math.max(0, size - marker.length - 1))}`
}