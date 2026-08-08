import { expectTypeOf } from 'vitest'
import type { EvidenceHit, FindingHit, RetrieverHit } from '../src/retrieval'
import type { StoredEvidence } from '../src/indexing'

declare const hit: RetrieverHit

if (hit.kind === 'finding') {
  expectTypeOf(hit).toEqualTypeOf<FindingHit>()
  expectTypeOf(hit.citation.findingTarget).toEqualTypeOf<string>()
  // @ts-expect-error finding hits do not expose chunk fields.
  hit.chunkId
} else {
  expectTypeOf(hit).toEqualTypeOf<EvidenceHit>()
  expectTypeOf(hit.source.id).toEqualTypeOf<string>()
  expectTypeOf(hit.chunkId).toEqualTypeOf<string>()
  expectTypeOf(hit.evidence).toEqualTypeOf<StoredEvidence>()
}
