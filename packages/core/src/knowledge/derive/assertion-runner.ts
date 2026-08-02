/**
 * Per-source assertion derive execution.
 *
 * @module
 */

import { z } from 'zod'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssetStore } from '../../storage'
import type { AssertionStage } from '../assertions/assertions'
import { createAssertionIdentity, toAssertionJsonData } from '../assertions/identity'
import type { AssertionRef } from '../assertions/relations'
import type { KnowledgeRef } from '../refs'
import {
  toAssertionClaimRecords,
  validateAssertionClaims,
  type AssertionClaimRecord,
  type RawAssertionClaim,
} from './assertion-claims'
import {
  toAssertionRelationClaimRecords,
  validateAssertionRelationClaims,
  type AssertionRelationClaimRecord,
  type RawAssertionRelationClaim,
} from './assertion-relation-claims'
import { generateObjectWithEvidence } from './modality-validation'
import { renderBoundedAssertionPrompt, renderBoundedRepairPrompt } from './prompt-bounds'

const refSchema: z.ZodType<KnowledgeRef> = z.union([
  z.object({ kind: z.literal('document'), sourceId: z.string() }).strict(),
  z.object({ kind: z.literal('parent'), sourceId: z.string(), parentId: z.string() }).strict(),
  z.object({ kind: z.literal('chunk'), sourceId: z.string(), chunkId: z.string() }).strict(),
  z.object({ kind: z.literal('entity'), entityId: z.string() }).strict(),
])

/** Run one assertion stage and return cached claim records. Internal. */
export async function runAssertionStage(input: {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
  readonly assets?: AssetStore
}): Promise<{
  readonly claims: readonly AssertionClaimRecord[]
  readonly relationClaims: readonly AssertionRelationClaimRecord[]
  readonly warnings: readonly string[]
}> {
  return input.stage.mode === 'run'
    ? runDeterministic(input)
    : runGenerated(input)
}

async function runDeterministic(input: {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
  readonly assets?: AssetStore
}): Promise<{
  readonly claims: readonly AssertionClaimRecord[]
  readonly relationClaims: readonly AssertionRelationClaimRecord[]
  readonly warnings: readonly string[]
}> {
  const raw: RawAssertionClaim[] = []
  const rawRelations: RawAssertionRelationClaim[] = []
  const emitted: AssertionRef[] = []
  const run = input.stage.run
  if (!run) throw new Error(`Derive ${input.stage.id} cannot run.`)
  await run({ document: input.document, chunks: input.chunks }, {
    emit: (type, data, opts) => {
      raw.push({
        type,
        data,
        evidence: opts.evidence,
        provenance: opts.provenance,
      })
      const ref = createEmittedRef(input.stage, type, data)
      emitted.push(ref)
      return ref
    },
    relate: (type, from, to, opts) => {
      rawRelations.push({ type, from, to, evidence: opts.evidence, provenance: opts.provenance })
    },
  })

  const validated = validateAssertionClaims(input.stage, raw, input.chunks)
  if (validated.errors.length > 0) {
    throw new Error(validated.errors[0] ?? `Derive ${input.stage.id} emitted an invalid assertion.`)
  }
  const relations = validateAssertionRelationClaims(input.stage, rawRelations, input.chunks, { emitted })
  if (relations.errors.length > 0) {
    throw new Error(relations.errors[0] ?? `Derive ${input.stage.id} emitted an invalid assertion relation.`)
  }
  return {
    claims: toAssertionClaimRecords(input.stage, input.document.sourceId, validated.claims),
    relationClaims: toAssertionRelationClaimRecords(input.stage, input.document.sourceId, relations.claims),
    warnings: [],
  }
}

async function runGenerated(input: {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
  readonly assets?: AssetStore
}): Promise<{
  readonly claims: readonly AssertionClaimRecord[]
  readonly relationClaims: readonly AssertionRelationClaimRecord[]
  readonly warnings: readonly string[]
}> {
  const rendered = renderBoundedAssertionPrompt(input.document, input.chunks, input.stage)
  const prompt = rendered.prompt
  const first = await readGeneratedAssertionClaims(input, prompt)
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = [...rendered.warnings]
  addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, first.claims))

  if (first.errors.length > 0) {
    const repairedPrompt = renderBoundedRepairPrompt({
      stageId: input.stage.id,
      sourceId: input.document.sourceId,
      prompt,
      errors: first.errors,
    })
    warnings.push(...repairedPrompt.warnings)
    const repaired = await readGeneratedAssertionClaims(input, repairedPrompt.prompt)
    addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, repaired.claims))
    for (const error of repaired.errors.length > 0 ? repaired.errors : first.errors) {
      warnings.push(`Derive ${input.stage.id} dropped invalid assertion: ${error}`)
    }
  }

  return { claims: [...valid.values()], relationClaims: [], warnings }
}

async function readGeneratedAssertionClaims(
  input: {
    readonly document: CruxDocument
    readonly chunks: readonly CruxChunk[]
    readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
    readonly assets?: AssetStore
  },
  prompt: string,
) {
  const { stage, chunks } = input
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate assertions.`)
  const schema = payloadSchema(stage)
  const result = await generateObjectWithEvidence({
    model,
    system: 'Return only assertions that match the requested schema.',
    prompt,
    schema,
    sourceId: input.document.sourceId,
    chunks,
    subject: `stage "${stage.id}"`,
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const parsed = schema.safeParse(result.object)
  if (!parsed.success) {
    return { claims: [], errors: parsed.error.issues.map((issue) => issue.path.join('.') || issue.message) }
  }
  return validateAssertionClaims(stage, parsed.data.assertions, chunks)
}

function payloadSchema(stage: AssertionStage<Record<string, z.ZodType<unknown>>>) {
  const typeNames = Object.keys(stage.types) as unknown as readonly [string, ...string[]]
  return z.object({
    assertions: z.array(z.object({
      type: z.enum(typeNames),
      data: z.unknown(),
      evidence: z.array(refSchema).optional(),
      provenance: z.enum(['exact', 'derived']).optional(),
    }).strict()),
  }).strict()
}

function addRecords(target: Map<string, AssertionClaimRecord>, records: readonly AssertionClaimRecord[]): void {
  for (const record of records) target.set(record.claimHash, record)
}

function createEmittedRef(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  type: string,
  data: unknown,
): AssertionRef {
  const schema = stage.types[type]
  const parsed = schema?.safeParse(data)
  const json = parsed?.success ? toAssertionJsonData(parsed.data) : undefined
  return {
    assertionId: createAssertionIdentity({
      stageId: stage.id,
      stageVersion: stage.version,
      stageFingerprint: stage.fingerprint(),
      type,
      data: json ?? null,
    }),
  }
}
