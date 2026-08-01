/**
 * Type-level contract for the connected knowledge public entrypoint.
 */

import { expectTypeOf } from 'vitest'
import { indexingPipeline, type IndexingPipeline } from '../src/indexing'
import {
  decodeKnowledgeRef,
  encodeKnowledgeRef,
  isKnowledgeRef,
  knowledgeModel,
  knowledgeBase,
  relate,
  type DeriveStage,
  type KnowledgeBase,
  type KnowledgeBaseConfig,
  type KnowledgeGraphReader,
  type KnowledgeModel,
  type KnowledgeNeighbor,
  type KnowledgeRef,
  type RelateEmitApi,
  type RelationStage,
  type RelationTypeSpec,
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

declare const generateText: Parameters<typeof knowledgeModel>[0]['generateText']
declare const generateObject: Parameters<typeof knowledgeModel>[0]['generateObject']

const extractor = knowledgeModel({
  name: 'docs-extractor',
  version: 1,
  generateText,
  generateObject,
})

expectTypeOf(extractor).toEqualTypeOf<KnowledgeModel>()

const references = relate({
  id: 'references',
  version: 1,
  types: {
    cites: {
      from: ['chunk'],
      to: ['document'],
      direction: 'directed',
      description: 'A chunk cites a document',
    },
  },
  run: (_input, api) => {
    expectTypeOf(api).toEqualTypeOf<RelateEmitApi<{
      readonly cites: {
        readonly from: readonly ['chunk']
        readonly to: readonly ['document']
        readonly direction: 'directed'
        readonly description: 'A chunk cites a document'
      }
    }>>()
    api.emit(
      'cites',
      { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
      { kind: 'document', sourceId: 'spec' },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
  },
})

expectTypeOf(references.types.cites).toMatchTypeOf<RelationTypeSpec>()
expectTypeOf(references).toMatchTypeOf<RelationStage<{
  readonly cites: {
    readonly from: readonly ['chunk']
    readonly to: readonly ['document']
    readonly direction: 'directed'
    readonly description: 'A chunk cites a document'
  }
}>>()
