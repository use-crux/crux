/**
 * Media ingest normalization for the indexing pipeline.
 *
 * Expands document-level shorthand, validates and canonicalizes media assets,
 * computes byte hashes, and derives attribution facts without persisting the
 * transient asset itself.
 *
 * @module
 */

import { normalizeEmbeddingInput } from '../embedding'
import type { EmbeddingModality, NormalizedEmbeddingInput } from '../embedding'
import type { Asset, AssetStore } from '../asset'
import { sourceFactsWithLocations } from './source-facts'
import type { CruxChunk, CruxDocument, CruxIngestPart, CruxSourceFacts } from './types'

const mediaModalities = ['image', 'audio', 'video', 'document'] as const
type MediaModality = (typeof mediaModalities)[number]
type MediaPart = Extract<CruxIngestPart, { kind: 'media' }>

/** Normalize media shorthand and parts before any indexing stage executes. */
export async function normalizeMediaDocument(
  document: CruxDocument,
  options: { readonly hasAssetStore: boolean },
): Promise<CruxDocument> {
  const authoredParts = document.parts ?? []
  const parts: CruxIngestPart[] = authoredParts.length > 0
    ? [...authoredParts]
    : document.content !== undefined
      ? [{ id: 'text:1', kind: 'text', content: document.content }]
      : []

  if (document.asset) {
    parts.push({
      id: availableAssetPartId(parts),
      kind: 'media',
      asset: document.asset,
    })
  }

  const normalizedParts = await Promise.all(parts.map(normalizePart))
  const warnings = [...(document.warnings ?? [])]
  if (
    !warnings.some((warning) => warning.code === 'media-unattributed') &&
    normalizedParts.some((part) =>
      part.kind === 'media' && !hasDurableAttribution(document.source, part, options.hasAssetStore))
  ) {
    warnings.push({
      code: 'media-unattributed',
      message: `Media source "${document.sourceId}" has no durable asset reference or HTTPS URL. Configure storage.assets to retain retrieval attribution.`,
    })
  }

  return {
    namespace: document.namespace,
    sourceId: document.sourceId,
    ...(document.source ? { source: document.source } : {}),
    ...(document.content !== undefined ? { content: document.content } : {}),
    ...(document.title !== undefined ? { title: document.title } : {}),
    ...(document.metadata !== undefined ? { metadata: document.metadata } : {}),
    ...(document.evidence !== undefined ? { evidence: document.evidence } : {}),
    ...(normalizedParts.length > 0 ? { parts: normalizedParts } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/** Safe source facts contributed by a canonical media part. */
export function mediaPartSourceFacts(part: MediaPart): CruxSourceFacts {
  return {
    ...(part.asset.type === 'url' && part.asset.url.protocol === 'https:'
      ? { url: part.asset.url.href }
      : {}),
    ...(part.asset.mediaType ? { mediaType: part.asset.mediaType } : {}),
  }
}

/** Whether a document contains transient media pipeline state. */
export function hasMediaParts(document: CruxDocument): boolean {
  return document.asset !== undefined || document.parts?.some((part) => part.kind === 'media') === true
}

/**
 * Canonicalize transient chunk media and optionally persist it for attribution.
 *
 * Caller-owned refs win over the configured store. Dry-runs normalize media
 * but never call the store.
 */
export async function materializeChunkMedia(
  chunks: readonly CruxChunk[],
  options: { readonly assets?: AssetStore; readonly dryRun: boolean },
): Promise<CruxChunk[]> {
  return Promise.all(chunks.map(async (chunk) => {
    if (!chunk.media) return chunk
    const input = await normalizeEmbeddingInput(
      { type: chunk.media.modality, source: chunk.media.asset },
      { embeddingName: 'indexer media ingest', supported: mediaModalities },
    )
    if (input.type === 'text') {
      throw new TypeError('Indexer media normalization unexpectedly produced text input.')
    }
    const media = {
      asset: input.asset,
      modality: input.type,
      ...(input.sha256 ? { sha256: input.sha256 } : {}),
    }
    const baseSource = sourceFactsWithLocations(
      { ...chunk.source, ...mediaAssetSourceFacts(input.asset) },
      chunk.provenance?.sourceLocations ?? [],
    )
    if (baseSource?.assetRef || options.dryRun || !options.assets) {
      return { ...chunk, ...(baseSource ? { source: baseSource } : {}), media }
    }
    const stored = await options.assets.put(input.asset)
    const source = sourceFactsWithLocations(
      { ...baseSource, assetRef: stored.ref },
      chunk.provenance?.sourceLocations ?? [],
    )
    return { ...chunk, ...(source ? { source } : {}), media }
  }))
}

async function normalizePart(part: CruxIngestPart): Promise<CruxIngestPart> {
  if (part.kind !== 'media') return part
  const input = part.modality
    ? await normalizeEmbeddingInput(
        { type: part.modality, source: part.asset },
        { embeddingName: 'indexer media ingest', supported: mediaModalities },
      )
    : await normalizeEmbeddingInput(part.asset, {
        embeddingName: 'indexer media ingest',
        supported: mediaModalities,
      })
  return normalizedMediaPart(part, input)
}

function normalizedMediaPart(part: MediaPart, input: NormalizedEmbeddingInput): MediaPart {
  if (input.type === 'text') {
    throw new TypeError('Indexer media normalization unexpectedly produced text input.')
  }
  return {
    id: part.id,
    kind: 'media',
    asset: input.asset,
    modality: input.type,
    ...(part.caption !== undefined ? { caption: part.caption } : {}),
    ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
    ...(part.sourceLocation !== undefined ? { sourceLocation: part.sourceLocation } : {}),
    ...(part.evidence !== undefined ? { evidence: part.evidence } : {}),
  }
}

function hasDurableAttribution(
  source: CruxSourceFacts | undefined,
  part: MediaPart,
  hasAssetStore: boolean,
): boolean {
  return Boolean(
    source?.assetRef ||
    hasAssetStore ||
    (part.asset.type === 'url' && part.asset.url.protocol === 'https:'),
  )
}

function mediaAssetSourceFacts(asset: Asset): CruxSourceFacts {
  return {
    ...(asset.type === 'url' && asset.url.protocol === 'https:' ? { url: asset.url.href } : {}),
    ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
  }
}

function availableAssetPartId(parts: readonly CruxIngestPart[]): string {
  const ids = new Set(parts.map((part) => part.id))
  let suffix = 1
  while (ids.has(`media:asset:${suffix}`)) suffix += 1
  return `media:asset:${suffix}`
}

/** Media modality union used by indexing internals. */
export type IndexingMediaModality = Exclude<EmbeddingModality, 'text'>
