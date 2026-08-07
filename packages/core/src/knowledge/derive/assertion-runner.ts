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
  /** Selected target chunks supplied to deterministic runs; all visible chunks without a selector. */
  readonly targets: readonly CruxChunk[]
  /** Evidence-admissible target keys; undefined when the stage has no selector. */
  readonly targetKeys: ReadonlySet<string> | undefined
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
  readonly targets: readonly CruxChunk[]
  readonly targetKeys: ReadonlySet<string> | undefined
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
  await run({ document: input.document, chunks: input.chunks, targets: input.targets }, {
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

  const validated = validateAssertionClaims(input.stage, raw, input.chunks, input.targetKeys)
  if (validated.errors.length > 0) {
    throw new Error(validated.errors[0] ?? `Derive ${input.stage.id} emitted an invalid assertion.`)
  }
  const relations = validateAssertionRelationClaims(input.stage, rawRelations, input.chunks, { emitted }, input.targetKeys)
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
  readonly targets: readonly CruxChunk[]
  readonly targetKeys: ReadonlySet<string> | undefined
}): Promise<{
  readonly claims: readonly AssertionClaimRecord[]
  readonly relationClaims: readonly AssertionRelationClaimRecord[]
  readonly warnings: readonly string[]
}> {
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = []
  if (input.targetKeys !== undefined && input.targetKeys.size === 0) {
    warnings.push(`Derive ${input.stage.id} has no target chunks for source ${input.document.sourceId}.`)
    return { claims: [], relationClaims: [], warnings }
  }

  for (const batch of renderBoundedAssertionBatches(input.document, input.chunks, input.stage, input.targetKeys)) {
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
    readonly targets: readonly CruxChunk[]
    readonly targetKeys: ReadonlySet<string> | undefined
  },
  batch: DerivePromptBatch,
): Promise<{ readonly claims: readonly AssertionClaimRecord[]; readonly warnings: readonly string[] }> {
  const first = await readGeneratedAssertionClaims(input, batch)
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = [...batch.warnings, ...first.warnings]
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
  warnings.push(...repaired.warnings)
  if (repaired.errors.length > 0) {
    throw assertionValidationExhausted(input.stage.id, repaired.validationError)
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
    readonly targets: readonly CruxChunk[]
    readonly targetKeys: ReadonlySet<string> | undefined
  },
  batch: DerivePromptBatch,
) {
  const { stage } = input
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate assertions.`)
  const schema = payloadSchema(stage)
  const result = await generateObjectWithEvidence({
    model,
    system: 'Return only assertions that match the requested schema. Cite evidence only from the chunk ids listed in the prompt; when target chunks are marked, cite only [TARGET:] chunk ids.',
    prompt: batch.prompt,
    schema,
    sourceId: input.document.sourceId,
    chunks: batch.chunks,
    subject: `stage "${stage.id}"`,
    ...(input.targetKeys !== undefined ? { targetKeys: input.targetKeys } : {}),
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const parsed = schema.safeParse(result.object)
  if (!parsed.success) {
    return {
      claims: [],
      warnings: result.warnings,
      errors: parsed.error.issues.map((issue) => issue.path.join('.') || issue.message),
      validationError: parsed.error,
    }
  }
  const validated = validateAssertionClaims(stage, parsed.data.assertions, batch.chunks, input.targetKeys)
  return {
    ...validated,
    warnings: result.warnings,
    validationError: new z.ZodError(validated.issues.map((issue) => ({
      ...issue,
      path: ['assertions', ...issue.path],
    }))),
  }
}

function payloadSchema(stage: AssertionStage<Record<string, z.ZodType<unknown>>>) {
  const evidence = z.array(z.object({
    kind: z.literal('chunk'),
    sourceId: z.string(),
    chunkId: z.string(),
  }).strict()).min(1)
  const assertionOptions = Object.entries(stage.types).map(([type, data]) => z.object({
    type: z.literal(type),
    data,
    evidence,
    provenance: z.enum(['exact', 'derived']),
  }).strict())
  const [firstAssertion, ...otherAssertions] = assertionOptions
  if (!firstAssertion) throw new Error('Structured assertion schema requires at least one type.')
  const assertion = z.discriminatedUnion('type', [firstAssertion, ...otherAssertions])
  return z.object({
    assertions: z.array(assertion),
  }).strict()
}

function assertionValidationExhausted(stageId: string, zodErrors: z.ZodError): ValidationExhaustedError {
  return new ValidationExhaustedError({
    zodErrors,
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
