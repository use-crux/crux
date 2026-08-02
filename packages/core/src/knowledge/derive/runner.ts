/**
 * Per-source derive runner with claim caching.
 *
 * @module
 */

import type { z } from 'zod'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssetStore, RecordStore } from '../../storage'
import type { AssertionStage } from '../assertions/assertions'
import type { RelationStage, RelationTypeSpec } from '../relate/relate'
import {
  readCachedAssertionClaimCount,
  replaceAssertionClaimRecords,
} from './assertion-claims'
import { runAssertionStage } from './assertion-runner'
import {
  claimManifestKey,
  claimsSchema,
  deriveClaimsSourceHash,
  readCachedClaimCount,
  readClaimManifest,
  replaceClaimRecords,
  toClaimRecords,
  validateRelationClaims,
  type ClaimRecord,
  type RawRelationClaim,
} from './claims'
import { generateObjectWithEvidence } from './modality-validation'
import { renderBoundedRelationPrompt, renderBoundedRepairPrompt } from './prompt-bounds'
import type { DeriveStage } from './stage'

/** Input for running configured derivations against one source. */
export interface RunDeriveStagesInput {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stages: readonly DeriveStage[]
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly assets?: AssetStore
}

/** Summary for one derive execution. */
export interface DeriveStageRunResult {
  readonly stageId: string
  readonly status: 'ran' | 'cached'
  readonly claims: number
  readonly warnings: readonly string[]
}

/** Run configured derivations and persist validated claims. */
export async function runDeriveStages(input: RunDeriveStagesInput): Promise<DeriveStageRunResult[]> {
  const sourceHash = deriveClaimsSourceHash(input.document, input.chunks)
  const results: DeriveStageRunResult[] = []

  for (const stage of orderStages(input.stages)) {
    const stageFingerprint = stage.fingerprint()
    const cached = stage.kind === 'assertion'
      ? await readCachedAssertionClaimCount({
        records: input.records,
        indexerId: input.indexerId,
        namespace: input.namespace,
        stage,
        sourceId: input.document.sourceId,
        sourceHash,
        stageFingerprint,
      })
      : await readCachedClaimCount({
        records: input.records,
        indexerId: input.indexerId,
        namespace: input.namespace,
        stage,
        sourceId: input.document.sourceId,
        sourceHash,
        stageFingerprint,
      })
    if (cached !== undefined) {
      const manifest = await readClaimManifest(input.records, claimManifestKey({
        indexerId: input.indexerId,
        namespace: input.namespace,
        stageId: stage.id,
        sourceId: input.document.sourceId,
      }))
      results.push({ stageId: stage.id, status: 'cached', claims: cached, warnings: manifestWarnings(manifest) })
      continue
    }

    const previous = await readClaimManifest(input.records, claimManifestKey({
      indexerId: input.indexerId,
      namespace: input.namespace,
      stageId: stage.id,
      sourceId: input.document.sourceId,
    }))
    if (isAssertionStage(stage)) {
      const run = await runAssertionStage({
        document: input.document,
        chunks: input.chunks,
        stage,
        ...(input.assets ? { assets: input.assets } : {}),
      })
      await replaceAssertionClaimRecords({
        records: input.records,
        indexerId: input.indexerId,
        namespace: input.namespace,
        stage,
        sourceId: input.document.sourceId,
        sourceHash,
        stageFingerprint,
        previous,
        claims: [...run.claims, ...run.relationClaims],
        warnings: run.warnings,
      })
      results.push({ stageId: stage.id, status: 'ran', claims: run.claims.length, warnings: run.warnings })
      continue
    } else {
      const run = await runOne(input, stage)
      await replaceClaimRecords({
        records: input.records,
        indexerId: input.indexerId,
        namespace: input.namespace,
        stage,
        sourceId: input.document.sourceId,
        sourceHash,
        stageFingerprint,
        previous,
        claims: run.claims,
        warnings: run.warnings,
      })
      results.push({ stageId: stage.id, status: 'ran', claims: run.claims.length, warnings: run.warnings })
    }
  }

  return results
}

async function runOne(
  input: RunDeriveStagesInput,
  stage: DeriveStage,
): Promise<{ readonly claims: readonly ClaimRecord[]; readonly warnings: readonly string[] }> {
  if (!isRelationStage(stage)) throw new Error(`Derive ${stage.id} cannot emit claims yet.`)
  if (stage.mode === 'run') return runDeterministic(input, stage)
  return runGenerated(input, stage)
}

async function runDeterministic(
  input: RunDeriveStagesInput,
  stage: RelationStage<Record<string, RelationTypeSpec>>,
): Promise<{ readonly claims: readonly ClaimRecord[]; readonly warnings: readonly string[] }> {
  const raw: RawRelationClaim[] = []
  const run = stage.run
  if (!run) throw new Error(`Derive ${stage.id} cannot run.`)
  await run({
    document: input.document,
    chunks: input.chunks,
    ...(input.assets ? { assets: input.assets } : {}),
  }, {
    emit: (type, from, to, opts) => {
      raw.push({
        type,
        from,
        to,
        description: opts?.description,
        evidence: opts?.evidence,
        provenance: opts?.provenance,
      })
    },
  })

  const validated = validateRelationClaims(stage, raw)
  if (validated.errors.length > 0) {
    throw new Error(validated.errors[0] ?? `Derive ${stage.id} emitted an invalid claim.`)
  }
  return { claims: toClaimRecords(stage, input.document.sourceId, validated.claims), warnings: [] }
}

async function runGenerated(
  input: RunDeriveStagesInput,
  stage: RelationStage<Record<string, RelationTypeSpec>>,
): Promise<{ readonly claims: readonly ClaimRecord[]; readonly warnings: readonly string[] }> {
  const rendered = renderBoundedRelationPrompt(input.document, input.chunks, stage)
  const prompt = rendered.prompt
  const first = await readGeneratedClaims(input, stage, prompt)
  const valid = new Map<string, ClaimRecord>()
  const warnings: string[] = [...rendered.warnings]
  addRecords(valid, toClaimRecords(stage, input.document.sourceId, first.claims))

  if (first.errors.length > 0) {
    const repairedPrompt = renderBoundedRepairPrompt({
      stageId: stage.id,
      sourceId: input.document.sourceId,
      prompt,
      errors: first.errors,
    })
    warnings.push(...repairedPrompt.warnings)
    const repaired = await readGeneratedClaims(input, stage, repairedPrompt.prompt)
    addRecords(valid, toClaimRecords(stage, input.document.sourceId, repaired.claims))
    for (const error of repaired.errors.length > 0 ? repaired.errors : first.errors) {
      warnings.push(`Derive ${stage.id} dropped invalid claim: ${error}`)
    }
  }

  return { claims: [...valid.values()], warnings }
}

async function readGeneratedClaims(
  input: RunDeriveStagesInput,
  stage: RelationStage<Record<string, RelationTypeSpec>>,
  prompt: string,
) {
  const model = stage.model
  if (!model) throw new Error(`Derive ${stage.id} cannot generate claims.`)
  const result = await generateObjectWithEvidence({
    model,
    system: 'Return only claims that match the requested schema.',
    prompt,
    schema: claimsSchema,
    sourceId: input.document.sourceId,
    chunks: input.chunks,
    subject: `stage "${stage.id}"`,
    ...(input.assets ? { assets: input.assets } : {}),
  })
  const parsed = claimsSchema.safeParse(result.object)
  if (!parsed.success) {
    return { claims: [], errors: parsed.error.issues.map((issue) => issue.message) }
  }
  return validateRelationClaims(stage, parsed.data.claims)
}

function orderStages(stages: readonly DeriveStage[]): readonly DeriveStage[] {
  const byId = new Map<string, DeriveStage>()
  for (const stage of stages) {
    if (byId.has(stage.id)) throw new Error(`Derive ${stage.id} is duplicated.`)
    byId.set(stage.id, stage)
  }
  const ordered: DeriveStage[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (stage: DeriveStage): void => {
    if (visited.has(stage.id)) return
    if (visiting.has(stage.id)) throw new Error(`Derive ${stage.id} has a dependency cycle.`)
    visiting.add(stage.id)
    for (const dependency of dependencies(stage)) {
      const found = byId.get(dependency)
      if (!found) throw new Error(`Derive ${stage.id} depends on unknown derive ${dependency}.`)
      visit(found)
    }
    visiting.delete(stage.id)
    visited.add(stage.id)
    ordered.push(stage)
  }
  stages.forEach(visit)
  return ordered
}

function dependencies(stage: DeriveStage): readonly string[] {
  const value = (stage as DeriveStage & { readonly dependsOn?: unknown }).dependsOn
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`Derive ${stage.id} has invalid dependencies.`)
  }
  return value
}

function isRelationStage(stage: DeriveStage): stage is RelationStage<Record<string, RelationTypeSpec>> {
  const value = stage as DeriveStage & { readonly types?: unknown; readonly mode?: unknown }
  return stage._tag === 'RelationStage' && isRecord(value.types) && (value.mode === 'run' || value.mode === 'model')
}

function isAssertionStage(stage: DeriveStage): stage is AssertionStage<Record<string, z.ZodType<unknown>>> {
  const value = stage as DeriveStage & { readonly types?: unknown; readonly mode?: unknown }
  return stage._tag === 'AssertionStage' && isRecord(value.types) && (value.mode === 'run' || value.mode === 'model')
}

function addRecords(target: Map<string, ClaimRecord>, records: readonly ClaimRecord[]): void {
  for (const record of records) target.set(record.claimHash, record)
}

function manifestWarnings(manifest: { readonly warnings?: readonly string[] } | undefined): readonly string[] {
  return manifest?.warnings ?? []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
