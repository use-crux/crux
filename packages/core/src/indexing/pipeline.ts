/**
 * Indexing pipeline authoring: transforms, chunkers, and pipeline composition.
 *
 * {@link transform} builds document/chunk transforms, {@link chunker} builds the
 * built-in chunkers (text/structured/parent-child/semantic), and
 * {@link indexingPipeline} composes them into a fingerprinted pipeline.
 *
 * @module
 */

import { chunkDocumentParentChild, chunkDocumentSemantic, chunkDocumentStructured } from './chunkers'
import { stableHash } from './hash'
import type { JsonObject } from '../storage'
import type {
  Chunker,
  ChunkerContext,
  ChunkingOptions,
  ChunkingResult,
  ChunkTransform,
  ChunkTransformContext,
  CruxChunk,
  CruxDocument,
  DocumentTransform,
  DocumentTransformContext,
  IndexingPipeline,
  IndexingPipelineConfig,
  ParentChildChunkerOptions,
  SemanticChunkerOptions,
  StructuredChunkerOptions,
} from './types'

/** Registry for building document and chunk transforms. */
export const transform = Object.freeze({
  document(config: {
    name: string
    version: string
    options?: JsonObject
    fingerprint?: unknown
    run(document: CruxDocument, ctx: DocumentTransformContext): Promise<CruxDocument> | CruxDocument
  }): DocumentTransform {
    validateStageIdentity('Document transform', config.name, config.version)
    return Object.freeze({
      _tag: 'DocumentTransform' as const,
      name: config.name,
      version: config.version,
      ...(config.options ? { options: config.options } : {}),
      ...(config.fingerprint !== undefined ? { fingerprint: config.fingerprint } : {}),
      run: config.run,
    })
  },

  chunk(config: {
    name: string
    version: string
    options?: JsonObject
    fingerprint?: unknown
    run(chunks: CruxChunk[], ctx: ChunkTransformContext): Promise<CruxChunk[]> | CruxChunk[]
  }): ChunkTransform {
    validateStageIdentity('Chunk transform', config.name, config.version)
    return Object.freeze({
      _tag: 'ChunkTransform' as const,
      name: config.name,
      version: config.version,
      ...(config.options ? { options: config.options } : {}),
      ...(config.fingerprint !== undefined ? { fingerprint: config.fingerprint } : {}),
      run: config.run,
    })
  },
})

/** Registry for building the built-in chunkers. */
export const chunker = Object.freeze({
  text(options: ChunkingOptions = {}): Chunker {
    return createChunker('text', '2', options, (document, ctx) => chunkDocumentStructured(document, ctx, options))
  },

  structured(options: StructuredChunkerOptions = {}): Chunker {
    return createChunker('structured', '2', options, (document, ctx) => chunkDocumentStructured(document, ctx, options))
  },

  parentChild(options: ParentChildChunkerOptions = {}): Chunker {
    const normalizedOptions = {
      parentMaxChars: options.parentMaxChars ?? 6000,
      childMaxChars: options.childMaxChars ?? 900,
      childOverlapChars: options.childOverlapChars ?? 120,
    }
    return createChunker('parent-child', '2', normalizedOptions, async (document) =>
      chunkDocumentParentChild(document, normalizedOptions),
    )
  },

  semantic(options: SemanticChunkerOptions): Chunker {
    return createChunker(`semantic:${options.strategy}`, '2', sanitizeFingerprint(options), async (document) =>
      chunkDocumentSemantic(document, options),
    )
  },
})

/** Compose document transforms, a chunker, and chunk transforms into a pipeline. */
export function indexingPipeline(config: IndexingPipelineConfig = {}): IndexingPipeline {
  const pipelineChunker = config.chunker ?? chunker.structured()
  const documents = Object.freeze([...(config.documents ?? [])])
  const chunks = Object.freeze([...(config.chunks ?? [])])
  const derive = Object.freeze([...(config.derive ?? [])])

  return Object.freeze({
    _tag: 'IndexingPipeline' as const,
    documents,
    chunker: pipelineChunker,
    chunks,
    derive,
    fingerprint(): string {
      return stableHash({
        documents: documents.map(stageFingerprint),
        chunker: {
          name: pipelineChunker.name,
          version: pipelineChunker.version,
          fingerprint: pipelineChunker.fingerprint(),
        },
        chunks: chunks.map(stageFingerprint),
        ...(derive.length > 0 ? { derive: derive.map(deriveStageFingerprint) } : {}),
      })
    },
  })
}

function validateStageIdentity(kind: string, name: string, version: string): void {
  if (!name.trim()) {
    throw new Error(`${kind} name must be non-empty.`)
  }
  if (!version.trim()) {
    throw new Error(`${kind} version must be non-empty.`)
  }
}

function createChunker(
  name: string,
  version: string,
  fingerprintInput: unknown,
  chunkDocument: (document: CruxDocument, ctx: ChunkerContext) => Promise<ChunkingResult> | ChunkingResult,
): Chunker {
  return Object.freeze({
    _tag: 'Chunker' as const,
    name,
    version,
    fingerprint: () => stableHash({ name, version, fingerprintInput }),
    chunkDocument,
  })
}

/** Build a stable fingerprint object for a transform stage. */
export function stageFingerprint(stage: {
  name: string
  version: string
  options?: JsonObject
  fingerprint?: unknown
}): JsonObject {
  return {
    name: stage.name,
    version: stage.version,
    ...(stage.options ? { options: stage.options } : {}),
    ...(stage.fingerprint !== undefined ? { fingerprint: sanitizeFingerprint(stage.fingerprint) as JsonObject[string] } : {}),
  }
}

function deriveStageFingerprint(stage: {
  kind: 'relation' | 'assertion'
  id: string
  version: number
  fingerprint(): string
}): JsonObject {
  return {
    kind: stage.kind,
    id: stage.id,
    version: stage.version,
    fingerprint: stage.fingerprint(),
  }
}

function sanitizeFingerprint(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if ('dense' in value || 'segment' in value) {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => key !== 'dense' && key !== 'segment')
        .map(([key, nested]) => [key, typeof nested === 'function' ? '[function]' : nested]),
    )
  }
  return value
}
