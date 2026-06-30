import type {
  IndexedStorageCapabilities,
  ProjectDefinitionKind,
  StorageFacts,
} from '@use-crux/core/project-index'
import { facts, type ConfigReader, type ExtractContext, type IndexExtractor } from '../extensions'
import type { StaticRelationRef } from '../types'

type StorageDefinitionKind = Extract<
  ProjectDefinitionKind,
  'storage.recordStore' | 'storage.vectorStore' | 'storage.blobStore' | 'storage.bundle' | 'storage.scope'
>

interface StorageFactoryDescriptor {
  readonly kind: StorageDefinitionKind
  readonly backend: string
  readonly capabilities?: IndexedStorageCapabilities
}

const inMemoryRecordCapabilities = {
  record: { ttl: 'lazy', filter: 'scan', watch: true, batch: false },
} as const satisfies IndexedStorageCapabilities

const inMemoryVectorCapabilities = {
  vector: { dense: true, sparse: true, hybrid: true, fusion: [], filter: 'pre', consistency: 'strong' },
} as const satisfies IndexedStorageCapabilities

const inMemoryBlobCapabilities = {
  blob: { multipart: false, signedUrls: false },
} as const satisfies IndexedStorageCapabilities

const storageFactoryByName: Readonly<Record<string, StorageFactoryDescriptor | undefined>> = {
  inMemoryRecordStore: {
    kind: 'storage.recordStore',
    backend: 'inMemoryRecordStore',
    capabilities: inMemoryRecordCapabilities,
  },
  inMemoryVectorStore: {
    kind: 'storage.vectorStore',
    backend: 'inMemoryVectorStore',
    capabilities: inMemoryVectorCapabilities,
  },
  inMemoryBlobStore: {
    kind: 'storage.blobStore',
    backend: 'inMemoryBlobStore',
    capabilities: inMemoryBlobCapabilities,
  },
  inMemoryStorage: {
    kind: 'storage.bundle',
    backend: 'inMemoryStorage',
    capabilities: {
      ...inMemoryRecordCapabilities,
      ...inMemoryVectorCapabilities,
      ...inMemoryBlobCapabilities,
    },
  },
  convexRecordStore: {
    kind: 'storage.recordStore',
    backend: 'convexRecordStore',
    capabilities: { record: { ttl: 'lazy', filter: 'scan', watch: false, batch: false } },
  },
  convexVectorStore: {
    kind: 'storage.vectorStore',
    backend: 'convexVectorStore',
    capabilities: {
      vector: { dense: true, sparse: false, hybrid: false, fusion: [], filter: 'post', consistency: 'strong' },
    },
  },
  convexWorkspaceBlobStore: {
    kind: 'storage.blobStore',
    backend: 'convexWorkspaceBlobStore',
    capabilities: { blob: { multipart: false, signedUrls: false } },
  },
  convexStorage: {
    kind: 'storage.bundle',
    backend: 'convexStorage',
    capabilities: {
      record: { ttl: 'lazy', filter: 'scan', watch: false, batch: false },
      vector: { dense: true, sparse: false, hybrid: false, fusion: [], filter: 'post', consistency: 'strong' },
      blob: { multipart: false, signedUrls: false },
    },
  },
  upstashRedisRecordStore: {
    kind: 'storage.recordStore',
    backend: 'upstashRedisRecordStore',
    capabilities: { record: { ttl: 'native', filter: 'scan', watch: 'unknown', batch: false } },
  },
  upstashVectorStore: {
    kind: 'storage.vectorStore',
    backend: 'upstashVectorStore',
    capabilities: {
      vector: { dense: true, sparse: false, hybrid: false, fusion: [], filter: 'pre', consistency: 'eventual' },
    },
  },
}

const storageFactoryNames = Object.keys(storageFactoryByName)

/** Extracts Storage Beta definitions, bundle composition, and scopes. */
export const storageIndexExtractor: IndexExtractor = {
  name: 'storage',
  patterns: [
    { kind: 'object' },
    { kind: 'call', name: 'storage' },
    { kind: 'call', name: 'scope' },
    ...storageFactoryNames.map((name) => ({ kind: 'call' as const, name })),
  ],
  extract: (ctx) => {
    if (ctx.match.kind === 'object') return extractBundleLiteral(ctx, ctx.config)
    if (ctx.match.name === 'storage') return extractStorageBundleCall(ctx)
    if (ctx.match.name === 'scope') return extractStorageScope(ctx)
    const descriptor = storageFactoryByName[ctx.match.name]
    return descriptor ? facts({ definitions: [factoryDefinition(ctx, descriptor)] }) : { kind: 'none' }
  },
}

function extractStorageBundleCall(ctx: ExtractContext) {
  return extractBundleDefinition(ctx, ctx.config, 'storage')
}

function extractBundleLiteral(ctx: ExtractContext, config: ConfigReader | undefined) {
  if (!config || !hasBundleFields(config)) return { kind: 'none' as const }
  return extractBundleDefinition(ctx, config)
}

function extractBundleDefinition(ctx: ExtractContext, config: ConfigReader | undefined, backend?: string) {
  if (!config || !hasBundleFields(config)) return { kind: 'none' as const }
  const refs = bundleRefs(config)
  const definition = ctx.define.definition({
    variableName: ctx.source.variableName,
    id: `storage.bundle:${ctx.source.safeId(ctx.source.variableName)}`,
    kind: 'storage.bundle',
    name: ctx.source.variableName,
    metadata: storageMetadata('storage.bundle', ctx.source.variableName, {
      backend,
      recordsVariable: refs.records,
      vectorsVariable: refs.vectors,
      blobsVariable: refs.blobs,
      facts: storageFacts({
        kind: 'storage.bundle',
        variableName: ctx.source.variableName,
        ...(backend ? { backend } : {}),
        ...(refs.records ? { records: refs.records } : {}),
        ...(refs.vectors ? { vectors: refs.vectors } : {}),
        ...(refs.blobs ? { blobs: refs.blobs } : {}),
      }),
      intelligence: {
        confidence: 'static',
        dependencies: {
          ...(refs.records ? { recordStores: [refs.records] } : {}),
          ...(refs.vectors ? { vectorStores: [refs.vectors] } : {}),
          ...(refs.blobs ? { blobStores: [refs.blobs] } : {}),
        },
      },
    }),
  })
  return facts({ definitions: [definition], references: bundleRelationRefs(refs) })
}

function extractStorageScope(ctx: ExtractContext) {
  const baseStorage = ctx.args.identifier(0)
  const prefix = ctx.args.string(1)
  if (!baseStorage && !prefix) return { kind: 'none' as const }
  const definition = ctx.define.definition({
    variableName: ctx.source.variableName,
    id: `storage.scope:${ctx.source.safeId(ctx.source.variableName)}`,
    kind: 'storage.scope',
    name: ctx.source.variableName,
    metadata: storageMetadata('storage.scope', ctx.source.variableName, {
      baseStorageVariable: baseStorage,
      prefix,
      facts: storageFacts({
        kind: 'storage.scope',
        variableName: ctx.source.variableName,
        ...(baseStorage ? { storage: baseStorage } : {}),
        ...(prefix ? { prefix } : {}),
      }),
      intelligence: {
        confidence: 'static',
        dependencies: {
          ...(baseStorage ? { storage: [baseStorage] } : {}),
        },
      },
    }),
  })
  return facts({
    definitions: [definition],
    references: baseStorage ? [ctx.ref.variable('storage.scope.wraps_storage', baseStorage)] : [],
  })
}

function factoryDefinition(ctx: ExtractContext, descriptor: StorageFactoryDescriptor) {
  return ctx.define.definition({
    variableName: ctx.source.variableName,
    id: `${descriptor.kind}:${ctx.source.safeId(ctx.source.variableName)}`,
    kind: descriptor.kind,
    name: ctx.source.variableName,
    metadata: storageMetadata(descriptor.kind, ctx.source.variableName, {
      backend: descriptor.backend,
      capabilities: descriptor.capabilities,
      facts: storageFacts({
        kind: descriptor.kind,
        backend: descriptor.backend,
        variableName: ctx.source.variableName,
        ...(descriptor.capabilities ? { capabilities: descriptor.capabilities } : {}),
      }),
      intelligence: { confidence: 'static' },
    }),
  })
}

function storageMetadata(
  kind: StorageDefinitionKind,
  variableName: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { exportName: variableName, variableName, kind, ...compactRecord(metadata) }
}

function storageFacts(input: StorageFacts): StorageFacts {
  return compactRecord(input) as unknown as StorageFacts
}

function bundleRefs(config: ConfigReader): { records?: string; vectors?: string; blobs?: string } {
  return {
    ...(config.reference('records') ? { records: config.reference('records') } : {}),
    ...(config.reference('vectors') ? { vectors: config.reference('vectors') } : {}),
    ...(config.reference('blobs') ? { blobs: config.reference('blobs') } : {}),
  }
}

function bundleRelationRefs(refs: { records?: string; vectors?: string; blobs?: string }): StaticRelationRef[] {
  return [
    ...(refs.records ? [{ type: 'storage.bundle.uses_record_store', toVariable: refs.records }] : []),
    ...(refs.vectors ? [{ type: 'storage.bundle.uses_vector_store', toVariable: refs.vectors }] : []),
    ...(refs.blobs ? [{ type: 'storage.bundle.uses_blob_store', toVariable: refs.blobs }] : []),
  ]
}

function hasBundleFields(config: ConfigReader): boolean {
  return config.has('records') || config.has('vectors') || config.has('blobs')
}

function compactRecord<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
