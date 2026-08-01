/**
 * Type-level contract for relation vocabulary authoring.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { indexingPipeline } from '../src/indexing'
import type { RelationDeriveStage } from '../src/knowledge/derive/stage'
import type { KnowledgeContentPart, KnowledgeModality, KnowledgeModel } from '../src/knowledge/model'
import { knowledgeModel, relateEntities, relateReferences } from '../src/knowledge'
import { relate, type RelationStage } from '../src/knowledge/relate/relate'

declare const model: KnowledgeModel

const modalities = ['text', 'image'] as const satisfies readonly KnowledgeModality[]
const multimodalModel = knowledgeModel({
  name: 'multimodal',
  version: '1',
  modalities,
  generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
  generateObject: async () => ({ object: {} }) as never,
  generateObjectFromParts: async <T>(args: {
    readonly system: string
    readonly parts: readonly KnowledgeContentPart[]
    readonly schema: z.ZodType<T>
  }) => {
    const media = args.parts.find((part) => part.kind === 'media')
    expectTypeOf(media?.bytesRef.ref.uri).toEqualTypeOf<string | undefined>()
    expectTypeOf(media?.mediaType).toEqualTypeOf<string | undefined>()
    return { object: {} as T }
  },
})

expectTypeOf(multimodalModel.modalities).toEqualTypeOf<readonly KnowledgeModality[] | undefined>()

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
    related: {
      from: ['entity'],
      to: ['entity'],
      direction: 'symmetric',
      description: 'Entities are related',
    },
  },
  run: (_input, api) => {
    api.emit(
      'cites',
      { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
      { kind: 'document', sourceId: 'spec' },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' }, provenance: 'exact' },
    )
    api.emit(
      'related',
      { kind: 'entity', entityId: 'alpha' },
      { kind: 'entity', entityId: 'beta' },
      { evidence: [{ kind: 'chunk', sourceId: 'guide', chunkId: 'c1' }] },
    )

    api.emit(
      // @ts-expect-error Relation type names are constrained by the authored vocabulary.
      'mentions',
      { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
      { kind: 'document', sourceId: 'spec' },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )

    api.emit(
      'cites',
      // @ts-expect-error Literal source references must match the relation endpoint kinds.
      { kind: 'document', sourceId: 'guide' },
      { kind: 'document', sourceId: 'spec' },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
  },
})

expectTypeOf(references).toMatchTypeOf<RelationDeriveStage>()
expectTypeOf(references).toMatchTypeOf<RelationStage<{
  readonly cites: {
    readonly from: readonly ['chunk']
    readonly to: readonly ['document']
    readonly direction: 'directed'
    readonly description: 'A chunk cites a document'
  }
  readonly related: {
    readonly from: readonly ['entity']
    readonly to: readonly ['entity']
    readonly direction: 'symmetric'
    readonly description: 'Entities are related'
  }
}>>()
const relationDeriveStage: RelationDeriveStage = references
indexingPipeline({ derive: [relationDeriveStage] })

relate({
  id: 'model-references',
  version: 1,
  types: {
    cites: {
      from: ['chunk'],
      to: ['document'],
      direction: 'directed',
      description: 'A chunk cites a document',
    },
  },
  model,
  instructions: 'Extract explicit citations',
})

// @ts-expect-error A relation config requires exactly one production mode.
relate({
  id: 'missing-mode',
  version: 1,
  types: {
    cites: {
      from: ['chunk'],
      to: ['document'],
      direction: 'directed',
      description: 'A chunk cites a document',
    },
  },
})

// @ts-expect-error A relation config cannot combine production modes.
relate({
  id: 'both-modes',
  version: 1,
  types: {
    cites: {
      from: ['chunk'],
      to: ['document'],
      direction: 'directed',
      description: 'A chunk cites a document',
    },
  },
  model,
  run: () => {},
})

const builtInReferences = relateReferences()
const builtInEntities = relateEntities({ model })

expectTypeOf(builtInReferences).toMatchTypeOf<RelationDeriveStage>()
expectTypeOf(builtInEntities).toMatchTypeOf<RelationDeriveStage>()
indexingPipeline({ derive: [builtInReferences, builtInEntities] })

// @ts-expect-error Entity relation extraction requires an explicit model.
relateEntities()
