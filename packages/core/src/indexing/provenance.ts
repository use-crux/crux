/**
 * Chunk provenance derivation and merging.
 *
 * Tracks which parts, pages, sheets, tables, JSON paths, and source spans a
 * chunk came from, and downgrades confidence to `derived` when a transform
 * rewrites content away from its source.
 *
 * @module
 */

import { unique, uniqueNumbers } from './collections'
import type { ChunkProvenance, CruxChunk, CruxDocument, CruxIngestPart, CruxParentChunk, CruxSourceLocation } from './types'

/** Build coarse provenance (part ids, pages, sheets, tables) from parts. */
export function coarseProvenance(parts: CruxIngestPart[]): ChunkProvenance {
  const partIds = parts.map((part) => part.id).filter(Boolean)
  const pages = uniqueNumbers(
    parts.flatMap((part) => {
      if (part.kind === 'page') return [part.pageNumber]
      if (part.kind === 'table' && part.pageNumber !== undefined) return [part.pageNumber]
      return []
    }),
  )
  const sheets = unique(
    parts.flatMap((part) => {
      if (part.kind === 'sheet') return [part.sheetName]
      if (part.kind === 'table' && part.sheetName) return [part.sheetName]
      return []
    }),
  )
  const tables = parts.filter((part) => part.kind === 'table').map((part) => part.id)
  const sourceLocations = uniqueSourceLocations(parts.flatMap((part) => part.sourceLocation ? [part.sourceLocation] : []))

  return {
    ...(partIds.length ? { partIds } : {}),
    ...(pages.length ? { pages } : {}),
    ...(sheets.length ? { sheets } : {}),
    ...(tables.length ? { tables } : {}),
    ...(sourceLocations.length ? { sourceLocations } : {}),
    confidence: 'exact',
  }
}

/** Provenance for one part's content, including resolved source spans. */
export function provenanceForPart(
  document: CruxDocument,
  part: CruxIngestPart,
  content: string = part.kind === 'media' ? (part.caption ?? '') : part.content,
): ChunkProvenance {
  const base = coarseProvenance([part])
  const sourceSpans = sourceSpanForContent(document, content, part.id)
  return {
    ...base,
    ...(part.kind === 'json' ? { jsonPaths: [part.path] } : {}),
    ...(sourceSpans.length ? { sourceSpans } : {}),
    confidence: sourceSpans.length || !document.content ? 'exact' : 'derived',
  }
}

/** Locate the source span of `content` within the document. */
export function sourceSpanForContent(
  document: CruxDocument,
  content: string,
  partId?: string,
): Array<{ start: number; end: number; partId?: string }> {
  if (!content) return []
  const start = document.content?.indexOf(content) ?? -1
  if (start < 0) return []
  return [
    {
      start,
      end: start + content.length,
      ...(partId ? { partId } : {}),
    },
  ]
}

/** Merge provenance from multiple chunks into one. */
export function mergeProvenance(items: ChunkProvenance[]): ChunkProvenance | undefined {
  if (!items.length) return undefined
  return {
    partIds: unique(items.flatMap((item) => item.partIds ?? [])),
    pages: uniqueNumbers(items.flatMap((item) => item.pages ?? [])),
    sheets: unique(items.flatMap((item) => item.sheets ?? [])),
    tables: unique(items.flatMap((item) => item.tables ?? [])),
    jsonPaths: unique(items.flatMap((item) => item.jsonPaths ?? [])),
    sourceLocations: uniqueSourceLocations(items.flatMap((item) => item.sourceLocations ?? [])),
    sourceSpans: items.flatMap((item) => item.sourceSpans ?? []),
    confidence: items.some((item) => item.confidence === 'derived') ? 'derived' : 'exact',
  }
}

function uniqueSourceLocations(locations: readonly CruxSourceLocation[]): CruxSourceLocation[] {
  const seen = new Set<string>()
  return locations.filter((location) => {
    const key = location.type === 'page'
      ? `page:${location.pageNumber}`
      : `time:${location.unit}:${location.start}:${location.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Apply a confidence downgrade to a chunk's provenance. */
export function applyProvenanceConfidence(chunk: CruxChunk, confidence: ChunkProvenance['confidence']): CruxChunk {
  if (!chunk.provenance) return chunk
  if (confidence === 'exact') return chunk
  return {
    ...chunk,
    provenance: { ...chunk.provenance, confidence },
  }
}

/** Apply a confidence downgrade to a parent chunk's provenance. */
export function applyParentProvenanceConfidence(
  parent: CruxParentChunk,
  confidence: ChunkProvenance['confidence'],
): CruxParentChunk {
  if (!parent.provenance) return parent
  if (confidence === 'exact') return parent
  return {
    ...parent,
    provenance: { ...parent.provenance, confidence },
  }
}
