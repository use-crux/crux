/**
 * Per-source assertion derive execution.
 *
 * @module
 */

import { z } from 'zod'
import { ValidationExhaustedError } from '../../generation/validation-retry'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssetStore } from '../../storage'
import type { AssertionStage } from '../assertions/assertions'
import { createAssertionIdentity, toAssertionJsonData } from '../assertions/identity'
import type { AssertionRef } from '../assertions/relations'
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
import { renderBoundedAssertionBatches, renderBoundedRepairPrompt, type DerivePromptBatch } from './prompt-bounds'

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
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = []

  for (const batch of renderBoundedAssertionBatches(input.document, input.chunks, input.stage)) {
    const run = await runGeneratedBatch(input, batch)
    addRecords(valid, run.claims)
    warnings.push(...run.warnings)
  }

  return { claims: [...valid.values()], relationClaims: [], warnings }
}

async function runGeneratedBatch(
  input: {
    readonly document: CruxDocument
    readonly chunks: readonly CruxChunk[]
    readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
    readonly assets?: AssetStore
  },
  batch: DerivePromptBatch,
): Promise<{ readonly claims: readonly AssertionClaimRecord[]; readonly warnings: readonly string[] }> {
  const first = await readGeneratedAssertionClaims(input, batch)
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = [...batch.warnings]
  addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, first.claims))
  if (first.errors.length === 0) return { claims: [...valid.values()], warnings }

  const repairedPrompt = renderBoundedRepairPrompt({
    stageId: input.stage.id,
    sourceId: input.document.sourceId,
    prompt: batch.prompt,
    errors: first.errors,
  })
  warnings.push(...repairedPrompt.warnings)
  const repaired = await readGeneratedAssertionClaims(input, { ...batch, prompt: repairedPrompt.prompt })
  if (repaired.errors.length > 0) {
    throw assertionValidationExhausted(input.stage.id, repaired.errors.length)
  }
  addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, repaired.claims))
  return { claims: [...valid.values()], warnings }
}

async function readGeneratedAssertionClaims(
  input: {
    readonly document: CruxDocument
    readonly chunks: readonly CruxChunk[]
    readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
    readonly assets?: AssetStore
  },
  batch: DerivePromptBatch,
) {
  const { stage } = input
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate assertions.`)
  const schema = payloadSchema(stage, batch.chunks)
  const result = await generateObjectWithEvidence({
    model,
    system: 'Return only assertions that match the requested schema.',
    prompt: batch.prompt,
    schema,
    sourceId: input.document.sourceId,
    chunks: batch.chunks,
    subject: `stage "${stage.id}"`,
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const parsed = schema.safeParse(result.object)
  if (!parsed.success) {
    return { claims: [], errors: parsed.error.issues.map((issue) => issue.path.join('.') || issue.message) }
  }
  return validateAssertionClaims(stage, parsed.data.assertions, batch.chunks)
}

function payloadSchema(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  chunks: readonly CruxChunk[],
) {
  const evidence = z.array(unionSchema(chunks.map((chunk) => z.object({
    kind: z.literal('chunk'),
    sourceId: z.literal(chunk.sourceId),
    chunkId: z.literal(chunk.chunkId),
  }).strict()))).min(1)
  const assertion = unionSchema(Object.entries(stage.types).map(([type, data]) => z.object({
    type: z.literal(type),
    data,
    evidence,
    provenance: z.enum(['exact', 'derived']).optional(),
  }).strict()))
  return z.object({
    assertions: z.array(assertion),
  }).strict()
}

function unionSchema<T>(schemas: readonly z.ZodType<T>[]): z.ZodType<T> {
  const [first, second, ...rest] = schemas
  if (!first) throw new Error('Structured assertion schema requires at least one option.')
  return second ? z.union([first, second, ...rest]) : first
}

function assertionValidationExhausted(stageId: string, issueCount: number): ValidationExhaustedError {
  const issues = Array.from({ length: Math.max(1, issueCount) }, (_, index) => ({
    code: 'custom' as const,
    path: ['assertions', index],
    message: 'invalid assertion',
  }))
  return new ValidationExhaustedError({
    zodErrors: new z.ZodError(issues),
    attempts: 1,
    maxAttempts: 1,
    promptId: stageId,
  })
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
