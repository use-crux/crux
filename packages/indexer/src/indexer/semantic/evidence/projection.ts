import type { IndexPatchFacts } from '../../patches'
import { projectAgentThreadRelations } from '../../relations'

/** Evidence array keys that semantic backends may stream. */
export const semanticEvidenceBatchKinds = [
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
] as const

/** Semantic evidence array key accepted by the backend stream contract. */
export type SemanticEvidenceBatchKind = (typeof semanticEvidenceBatchKinds)[number]

/**
 * One backend-neutral semantic evidence batch.
 *
 * Evidence is deliberately Crux-shaped and compiler-free. Backends may use
 * TypeScript, TypeScript-Go, or a future native implementation internally, but
 * they must stream rows that the shared projector can lower into Project Index
 * patch facts without seeing compiler nodes or symbols.
 */
export type SemanticEvidenceBatch<TKind extends SemanticEvidenceBatchKind = SemanticEvidenceBatchKind> = {
  readonly [TCurrentKind in TKind]: {
    /** Evidence row kind represented by this batch. */
    readonly kind: TCurrentKind
    /** Evidence rows for `kind`. */
    readonly facts: NonNullable<IndexPatchFacts[TCurrentKind]>
  }
}[TKind]

/** Synchronous or asynchronous semantic evidence stream. */
export type SemanticEvidenceBatchSource = Iterable<SemanticEvidenceBatch> | AsyncIterable<SemanticEvidenceBatch>

/** Materializes streamed semantic evidence into Project Index patch facts. */
export async function collectProjectedSemanticEvidence(
  batches: SemanticEvidenceBatchSource,
): Promise<IndexPatchFacts> {
  return projectSemanticEvidenceBatches(await materializeEvidenceBatches(batches))
}

/** Projects backend-neutral evidence batches into Project Index patch facts. */
export function projectSemanticEvidenceBatches(batches: Iterable<SemanticEvidenceBatch>): IndexPatchFacts {
  const facts: MutableSemanticEvidenceFacts = { diagnostics: [] }
  for (const batch of batches) appendSemanticEvidenceBatch(facts, batch)
  if (facts.relations) facts.relations = projectAgentThreadRelations(facts.relations)
  return facts
}

/** Converts cached patch facts into evidence batches for the shared stream path. */
export function* semanticEvidenceBatchesFromFacts(facts: IndexPatchFacts): Iterable<SemanticEvidenceBatch> {
  if (facts.definitions?.length) yield { kind: 'definitions', facts: facts.definitions }
  if (facts.relations?.length) yield { kind: 'relations', facts: facts.relations }
  if (facts.sourceRefs?.length) yield { kind: 'sourceRefs', facts: facts.sourceRefs }
  if (facts.diagnostics) yield { kind: 'diagnostics', facts: facts.diagnostics }
  if (facts.lintFindings?.length) yield { kind: 'lintFindings', facts: facts.lintFindings }
}

interface MutableSemanticEvidenceFacts {
  definitions?: ArrayElement<NonNullable<IndexPatchFacts['definitions']>>[]
  relations?: ArrayElement<NonNullable<IndexPatchFacts['relations']>>[]
  sourceRefs?: ArrayElement<NonNullable<IndexPatchFacts['sourceRefs']>>[]
  diagnostics?: ArrayElement<NonNullable<IndexPatchFacts['diagnostics']>>[]
  lintFindings?: ArrayElement<NonNullable<IndexPatchFacts['lintFindings']>>[]
}

type ArrayElement<TValue> = TValue extends readonly (infer TElement)[] ? TElement : never

async function materializeEvidenceBatches(
  batches: SemanticEvidenceBatchSource,
): Promise<readonly SemanticEvidenceBatch[]> {
  const materialized: SemanticEvidenceBatch[] = []
  for await (const batch of batches) materialized.push(batch)
  return materialized
}

function appendSemanticEvidenceBatch(target: MutableSemanticEvidenceFacts, batch: SemanticEvidenceBatch): void {
  switch (batch.kind) {
    case 'definitions':
      target.definitions = [...(target.definitions ?? []), ...batch.facts]
      return
    case 'relations':
      target.relations = [...(target.relations ?? []), ...batch.facts]
      return
    case 'sourceRefs':
      target.sourceRefs = [...(target.sourceRefs ?? []), ...batch.facts]
      return
    case 'diagnostics':
      target.diagnostics = [...(target.diagnostics ?? []), ...batch.facts]
      return
    case 'lintFindings':
      target.lintFindings = [...(target.lintFindings ?? []), ...batch.facts]
      return
  }
}
