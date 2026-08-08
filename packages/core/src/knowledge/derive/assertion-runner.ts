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
import {
  renderBoundedAssertionBatches,
  renderBoundedRepairPrompt,
  type DerivePromptBatch,
  type EvidenceRef,
} from './prompt-bounds'
import { compileAssertionWire, type AssertionWireManifest } from './assertion-wire'

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

  const invalidSlots = first.errors.some((error) => error.slot === '<root>')
    ? first.manifest.slots.map((entry) => entry.slot)
    : [...new Set(first.errors.map((error) => error.slot))]
        .filter((slot) => manifestSlot(first.manifest, slot))
  const repairedPrompt = renderBoundedRepairPrompt({
    stageId: input.stage.id,
    sourceId: input.document.sourceId,
    prompt: batch.prompt,
    invalidSlots,
    errors: first.errors.map((error) => error.message),
  })
  warnings.push(...repairedPrompt.warnings)
  const repaired = await readGeneratedAssertionClaims(input, { ...batch, prompt: repairedPrompt.prompt }, invalidSlots)
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
  repairSlots?: readonly string[],
) {
  const { stage } = input
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate assertions.`)
  const citeableLabels = batch.evidenceRefs
    .filter(({ citeable }) => citeable)
    .map(({ label }) => label)
  const compiled = compileAssertionWire(stage.types, citeableLabels)
  const manifest = compiled.manifest
  const schema = compiled.schema
  const result = await generateObjectWithEvidence({
    model,
    system: 'Return only assertions that match the requested schema. Cite evidence only with the e-labels listed on [TARGET:] chunks. Never cite c-labels from [CONTEXT:] chunks.',
    prompt: batch.prompt,
    schema,
    sourceId: input.document.sourceId,
    chunks: batch.chunks,
    subject: `stage "${stage.id}"`,
    ...(input.targetKeys !== undefined ? { targetKeys: input.targetKeys } : {}),
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const decoded = decodeWire(result.object, manifest, batch.evidenceRefs, repairSlots)
  const validated = validateAssertionClaims(stage, decoded.claims, batch.chunks, input.targetKeys)
  const errors = [
    ...decoded.errors,
    ...validationErrors(validated.errors, validated.issues, decoded.claimSlots),
  ]
  return {
    ...validated,
    errors,
    warnings: result.warnings,
    manifest,
    validationError: new z.ZodError([
      ...decoded.errors.map((error) => ({ code: 'custom' as const, path: [error.slot], message: error.message })),
      ...validated.issues.map((issue) => ({
        ...issue,
        path: [decoded.claimSlots[Number(issue.path[0])] ?? '<root>', ...issue.path.slice(1)],
      })),
    ]),
  }
}

function manifestSlot(manifest: AssertionWireManifest, slot: string): boolean {
  return manifest.slots.some((entry) => entry.slot === slot)
}

function validationErrors(
  messages: readonly string[],
  issues: readonly z.core.$ZodIssue[],
  claimSlots: readonly string[],
): readonly { slot: string; message: string }[] {
  const failedIndexes = [...new Set(issues.map((issue) => Number(issue.path[0])).filter(Number.isInteger))]
  return messages.map((message, index) => ({ slot: claimSlots[failedIndexes[index] ?? -1] ?? '<root>', message }))
}

function decodeWire(
  value: unknown,
  manifest: AssertionWireManifest,
  evidenceRefs: readonly EvidenceRef[],
  repairSlots?: readonly string[],
): {
  claims: RawAssertionClaim[]; claimSlots: string[]; errors: { slot: string; message: string }[]
} {
  const claims: RawAssertionClaim[] = []
  const claimSlots: string[] = []
  const errors: { slot: string; message: string }[] = []
  if (!isRecord(value)) return { claims, claimSlots, errors: [{ slot: '<root>', message: 'response must be an object' }] }
  const expected = new Set(manifest.slots.map((entry) => entry.slot))
  for (const key of Object.keys(value)) {
    if (!expected.has(key as `type_${number}`)) errors.push({ slot: key, message: `${key}: unknown assertion slot` })
  }
  for (const entry of manifest.slots) {
    const items = value[entry.slot]
    if (!Array.isArray(items)) {
      errors.push({ slot: entry.slot, message: `${entry.slot}: required array is missing` })
      continue
    }
    if (repairSlots !== undefined && !repairSlots.includes(entry.slot)) {
      if (items.length > 0) errors.push({ slot: entry.slot, message: `${entry.slot}: repair must return [] for retained slots` })
      continue
    }
    items.forEach((item, index) => {
      const envelope = z.object({
        ...(entry.mode === 'typed' ? { data: z.unknown() } : { dataJson: z.string() }),
        evidence: z.array(z.string()).min(1),
        provenance: z.enum(['exact', 'derived']),
      }).strict().safeParse(item)
      if (!envelope.success) {
        errors.push({ slot: entry.slot, message: `${entry.slot}[${index}]: ${envelope.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}` })
        return
      }
      let data: unknown
      if (entry.mode === 'json-string') {
        try { data = JSON.parse((envelope.data as { dataJson: string }).dataJson) }
        catch { errors.push({ slot: entry.slot, message: `${entry.slot}[${index}]: malformed dataJson` }); return }
      } else data = (envelope.data as { data: unknown }).data
      const evidence = envelope.data.evidence.flatMap((label) => {
        const match = evidenceRefs.find((candidate) => candidate.citeable && candidate.label === label)

        return match === undefined
          ? []
          : [{ kind: 'chunk' as const, sourceId: match.chunk.sourceId, chunkId: match.chunk.chunkId }]
      })
      if (evidence.length !== envelope.data.evidence.length) {
        errors.push({ slot: entry.slot, message: `${entry.slot}[${index}]: unknown or context-only evidence label` })
        return
      }

      claims.push({ type: entry.type, data, evidence, provenance: envelope.data.provenance })
      claimSlots.push(entry.slot)
    })
  }
  return { claims, claimSlots, errors }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
