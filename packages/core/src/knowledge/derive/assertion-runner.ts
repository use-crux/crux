/**
 * Per-source assertion derive execution.
 *
 * @module
 */

import { z } from 'zod'
import { stableStringify } from '../../indexing/hash'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssertionStage } from '../assertions/assertions'
import type { KnowledgeRef } from '../refs'
import {
  toAssertionClaimRecords,
  validateAssertionClaims,
  type AssertionClaimRecord,
  type RawAssertionClaim,
} from './assertion-claims'

const MAX_PROMPT_CHARS = 12000
const MAX_CHUNK_CHARS = 1200

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
}): Promise<{ readonly claims: readonly AssertionClaimRecord[]; readonly warnings: readonly string[] }> {
  return input.stage.mode === 'run'
    ? runDeterministic(input)
    : runGenerated(input)
}

async function runDeterministic(input: {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
}): Promise<{ readonly claims: readonly AssertionClaimRecord[]; readonly warnings: readonly string[] }> {
  const raw: RawAssertionClaim[] = []
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
    },
  })

  const validated = validateAssertionClaims(input.stage, raw, input.chunks)
  if (validated.errors.length > 0) {
    throw new Error(validated.errors[0] ?? `Derive ${input.stage.id} emitted an invalid assertion.`)
  }
  return {
    claims: toAssertionClaimRecords(input.stage, input.document.sourceId, validated.claims),
    warnings: [],
  }
}

async function runGenerated(input: {
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly stage: AssertionStage<Record<string, z.ZodType<unknown>>>
}): Promise<{ readonly claims: readonly AssertionClaimRecord[]; readonly warnings: readonly string[] }> {
  const prompt = renderPrompt(input.document, input.chunks, input.stage)
  const first = await readGeneratedAssertionClaims(input.stage, input.chunks, prompt)
  const valid = new Map<string, AssertionClaimRecord>()
  const warnings: string[] = []
  addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, first.claims))

  if (first.errors.length > 0) {
    const repaired = await readGeneratedAssertionClaims(
      input.stage,
      input.chunks,
      `${prompt}\n\nFix these validation errors:\n${first.errors.join('\n')}`,
    )
    addRecords(valid, toAssertionClaimRecords(input.stage, input.document.sourceId, repaired.claims))
    for (const error of repaired.errors.length > 0 ? repaired.errors : first.errors) {
      warnings.push(`Derive ${input.stage.id} dropped invalid assertion: ${error}`)
    }
  }

  return { claims: [...valid.values()], warnings }
}

async function readGeneratedAssertionClaims(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  chunks: readonly CruxChunk[],
  prompt: string,
) {
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate assertions.`)
  const schema = payloadSchema(stage)
  const result = await model.generateObject({
    system: 'Return only assertions that match the requested schema.',
    prompt,
    schema,
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

function renderPrompt(
  document: CruxDocument,
  chunks: readonly CruxChunk[],
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
): string {
  const vocabulary = Object.entries(stage.types).map(([name, schema]) =>
    `${name}: ${stableStringify(z.toJSONSchema(schema))}`,
  )
  return bound([
    stage.instructions ?? '',
    `Source: ${document.sourceId}`,
    document.title ? `Title: ${document.title}` : '',
    `Vocabulary:\n${vocabulary.join('\n')}`,
    `Document:\n${bound(document.content ?? '', MAX_CHUNK_CHARS)}`,
    `Chunks:\n${chunks.map((chunk) =>
      `[${chunk.sourceId}/${chunk.chunkId}] ${bound(chunk.content, MAX_CHUNK_CHARS)}`).join('\n')}`,
  ].filter(Boolean).join('\n\n'), MAX_PROMPT_CHARS)
}

function addRecords(target: Map<string, AssertionClaimRecord>, records: readonly AssertionClaimRecord[]): void {
  for (const record of records) target.set(record.claimHash, record)
}

function bound(value: string, max = MAX_PROMPT_CHARS): string {
  return value.length <= max ? value : value.slice(0, max)
}
