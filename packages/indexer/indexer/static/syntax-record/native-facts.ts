import type { ExtractedFacts, IndexerExtensionRuntime } from '../../extensions'
import { extractedFactsFromStaticExtractionResult } from '../../extensions'
import type { StaticRecordExtractorIdentity } from '../../static-index/compatibility/syntax-record-bridge/runtime'
import type { StaticNativeFactProjection, StaticSyntaxFileRecord } from './types'

/**
 * Controls how native fact packets embedded in syntax records participate in
 * record projection.
 *
 * `inline` is the existing combined path: native packets and TypeScript
 * extractor facts are joined before relation binding. `external` is the
 * TypeScript-extension lane: native packets still suppress replaced bundled
 * extractors but are not emitted by this parser result. `native-only` is the
 * native packet lane: TypeScript extractors are not executed for output.
 *
 * Relation binding may still read imported native and TypeScript definitions as
 * support evidence. The mode controls emitted facts, not the compatibility
 * lookup surface needed to keep cross-lane references resolvable.
 */
export type NativeFactProjectionMode = 'inline' | 'external' | 'native-only'

export interface NativeFactEntry {
  readonly facts: readonly ExtractedFacts[]
  readonly replacedExtractors?: readonly StaticRecordExtractorIdentity[]
}

export type NativeFactIndex = ReadonlyMap<number, NativeFactEntry>

/** Indexes native fact packets by syntax-record match index. */
export function createNativeFactIndex(record: StaticSyntaxFileRecord): NativeFactIndex {
  const factsByMatchIndex = new Map<
    number,
    { facts: ExtractedFacts[]; replacedExtractors: StaticRecordExtractorIdentity[] }
  >()
  for (const projection of record.nativeFacts ?? []) {
    assertNativeFactProjection(record, projection)
    // Native fact packets are emitted by compiler-owned frontends after ExtractedFacts
    // normalization; this boundary only revalidates match ownership before reusing them.
    const existing = factsByMatchIndex.get(projection.matchIndex)
    if (existing) {
      existing.facts.push(projection.facts as ExtractedFacts)
      existing.replacedExtractors.push(...nativeFactReplacedExtractors(projection))
      continue
    }
    factsByMatchIndex.set(projection.matchIndex, {
      facts: [projection.facts as ExtractedFacts],
      replacedExtractors: nativeFactReplacedExtractors(projection),
    })
  }
  return factsByMatchIndex
}

/** Projects one runtime extraction result into a fact array. */
export function extractedFacts(
  result: ReturnType<IndexerExtensionRuntime['extractStaticRecord']>,
): readonly ExtractedFacts[] {
  const extracted = extractedFactsFromStaticExtractionResult(result)
  return extracted ? [extracted] : []
}

function nativeFactReplacedExtractors(projection: StaticNativeFactProjection): StaticRecordExtractorIdentity[] {
  return (projection.replaces ?? []).map((item) => ({
    extension: item.extension,
    extractor: item.extractor,
  }))
}

function assertNativeFactProjection(record: StaticSyntaxFileRecord, projection: StaticNativeFactProjection): void {
  if (
    !Number.isInteger(projection.matchIndex) ||
    projection.matchIndex < 0 ||
    projection.matchIndex >= record.matches.length
  ) {
    throw new Error(`Invalid native fact projection match index ${projection.matchIndex} for ${record.file}`)
  }
}
