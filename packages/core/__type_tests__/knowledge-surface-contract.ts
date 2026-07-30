/**
 * Type-level contract for the connected knowledge public entrypoint.
 */

import { expectTypeOf } from 'vitest'
import { indexingPipeline, type IndexingPipeline } from '../src/indexing'
import {
  decodeKnowledgeRef,
  encodeKnowledgeRef,
  isKnowledgeRef,
  knowledgeBase,
  type DeriveStage,
  type KnowledgeBase,
  type KnowledgeBaseConfig,
  type KnowledgeGraphReader,
  type KnowledgeNeighbor,
  type KnowledgeRef,
} from '../src/knowledge'
import { inMemoryStorage } from '../src/storage'

const pipeline = indexingPipeline()
const docs = knowledgeBase({
  id: 'docs',
  storage: inMemoryStorage(),
  pipeline,
})

expectTypeOf(docs).toEqualTypeOf<KnowledgeBase>()
expectTypeOf<KnowledgeBaseConfig>().toMatchTypeOf<{
  pipeline?: IndexingPipeline
}>()

const relationStage = {
  _tag: 'RelationStage',
  kind: 'relation',
  id: 'references',
  version: 1,
  fingerprint: () => 'references:v1',
} as const satisfies DeriveStage

expectTypeOf(indexingPipeline({ derive: [relationStage] }).derive).toEqualTypeOf<readonly DeriveStage[]>()

const chunkRef: KnowledgeRef = { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' }
expectTypeOf(encodeKnowledgeRef(chunkRef)).toEqualTypeOf<string>()
expectTypeOf(decodeKnowledgeRef('chunk:guide:c1')).toEqualTypeOf<KnowledgeRef | null>()
expectTypeOf(isKnowledgeRef(chunkRef)).toEqualTypeOf<boolean>()
expectTypeOf<Awaited<ReturnType<KnowledgeGraphReader['neighbors']>>>().toEqualTypeOf<KnowledgeNeighbor[]>()
