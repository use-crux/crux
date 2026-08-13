/** Media-part to transient-chunk projection. @module */

import { createStableId } from './hash'
import { createStoredEvidence } from './stored-evidence'
import { mediaPartSourceFacts } from './media'
import { provenanceForPart } from './provenance'
import { sourceFactsWithLocations } from './source-facts'
import type { CruxChunk, CruxDocument, CruxIngestPart } from './types'

type MediaPart = Extract<CruxIngestPart, { kind: 'media' }>

/** Build the single unsplit chunk owned by one media ingest part. */
export function createMediaPartChunk(
  document: CruxDocument,
  part: MediaPart,
  ordinal: number,
): CruxChunk {
  if (!part.modality) {
    throw new TypeError(`Media part "${part.id}" was not normalized before chunking.`)
  }
  const content = part.caption ?? ''
  const provenance = provenanceForPart(document, part, content)
  const source = sourceFactsWithLocations(
    { ...document.source, ...mediaPartSourceFacts(part) },
    provenance.sourceLocations ?? [],
  )
  const sha256 = part.asset.type === 'data' ? part.asset.sha256 : undefined

  const chunkId = createStableId('chunk', {
    sourceId: document.sourceId,
    partId: part.id,
    ordinal,
    modality: part.modality,
    media: mediaIdentity(part),
    content,
  })
  return {
    namespace: document.namespace,
    sourceId: document.sourceId,
    chunkId,
    ordinal,
    content,
    metadata: { ...(document.metadata ?? {}), ...(part.metadata ?? {}) },
    ...(source ? { source } : {}),
    ...(document.title ? { parent: { title: document.title } } : {}),
    ...(provenance ? { provenance } : {}),
    ...(document.evidence && part.evidence
      ? { evidence: createStoredEvidence({ document: document.evidence, origin: part.evidence, chunkId, normalizedContent: content, chunkerVersion: 'media:2' }) }
      : {}),
    media: {
      asset: part.asset,
      modality: part.modality,
      ...(sha256 ? { sha256 } : {}),
    },
  }
}

/** Return normalized media parts in authored order. */
export function mediaParts(document: CruxDocument): MediaPart[] {
  return (document.parts ?? []).filter((part): part is MediaPart => part.kind === 'media')
}

function mediaIdentity(part: MediaPart): string {
  if (part.asset.type === 'data') return part.asset.sha256 ?? 'unhashed-data'
  if (part.asset.type === 'url') return part.asset.url.href
  return `${part.asset.provider}:${part.asset.fileId}`
}
