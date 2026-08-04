/**
 * Raw text splitting and semantic boundary computation.
 *
 * Provides paragraph/sentence-aware character splitting ({@link splitDocument})
 * and embedding-similarity boundary detection ({@link embeddingBoundaries}) used
 * by the structured and semantic chunkers.
 *
 * @module
 */

import type { DenseEmbedding } from '../embedding'
import type { ChunkingOptions, CruxDocument, SemanticBoundary } from './types'

/** A contiguous slice of a source text. */
export interface TextSlice {
  readonly content: string
  readonly start: number
  readonly end: number
}

/** Split content into sentence segments with character offsets. */
export function sentenceSegments(content: string): Array<{ text: string; start: number; end: number }> {
  const matches = [...content.matchAll(/[^.!?\n]+[.!?]?\s*/g)]
  if (!matches.length) return [{ text: content, start: 0, end: content.length }]
  return matches
    .map((match) => ({
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter((segment) => segment.text.trim())
}

/** Compute semantic boundaries from segment embedding similarity. */
export async function embeddingBoundaries(
  document: CruxDocument,
  segments: Array<{ text: string; start: number; end: number }>,
  dense: DenseEmbedding,
  options: { minChars: number; maxChars: number; similarityThreshold?: number },
): Promise<SemanticBoundary[]> {
  if (segments.length <= 1) {
    return [{ start: 0, end: document.content?.length ?? 0, reason: 'single-segment' }]
  }
  const embeddings = await dense.embedMany(segments.map((segment) => segment.text))
  const boundaries: SemanticBoundary[] = []
  let startSegment = 0
  let currentLength = 0
  for (let index = 0; index < segments.length; index++) {
    currentLength += segments[index].text.length
    const nextScore = index < segments.length - 1 ? cosineSimilarity(embeddings[index], embeddings[index + 1]) : 1
    const shouldSplit =
      currentLength >= options.maxChars ||
      (currentLength >= options.minChars && nextScore < (options.similarityThreshold ?? 0.75))
    if (shouldSplit || index === segments.length - 1) {
      boundaries.push({
        start: segments[startSegment].start,
        end: segments[index].end,
        reason: shouldSplit ? 'semantic-boundary' : 'final',
        confidence: shouldSplit ? 1 - nextScore : 1,
      })
      startSegment = index + 1
      currentLength = 0
    }
  }
  return boundaries
}

/** Clamp boundaries to the content range and drop empty spans. */
export function normalizeBoundaries(boundaries: SemanticBoundary[], contentLength: number): SemanticBoundary[] {
  if (!boundaries.length) return [{ start: 0, end: contentLength, reason: 'fallback' }]
  return boundaries
    .map((boundary) => ({
      ...boundary,
      start: Math.max(0, Math.min(boundary.start, contentLength)),
      end: Math.max(0, Math.min(boundary.end, contentLength)),
    }))
    .filter((boundary) => boundary.end > boundary.start)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

/** Split content into chunks at paragraph boundaries, with overlap. */
export function splitDocument(content: string, options: Required<ChunkingOptions>): string[] {
  return splitDocumentSlices(content, options).map((slice) => slice.content)
}

/** Split content into original-source slices at paragraph boundaries, with overlap. */
export function splitDocumentSlices(content: string, options: Required<ChunkingOptions>): TextSlice[] {
  if (content.length <= options.maxChars) {
    return [{ content, start: 0, end: content.length }]
  }

  const paragraphs = paragraphSlices(content)

  const chunks: TextSlice[] = []
  let current: TextSlice | undefined

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content]) {
    const paragraphSlice = typeof paragraph === 'string'
      ? { content: paragraph, start: 0, end: paragraph.length }
      : paragraph
    if (paragraphSlice.content.length > options.maxChars) {
      flushCurrent()
      for (const piece of splitLargeParagraph(content, paragraphSlice.start, paragraphSlice.end, options.maxChars)) {
        pushChunk(piece)
      }
      continue
    }

    const candidate = current
      ? { start: current.start, end: paragraphSlice.end, content: content.slice(current.start, paragraphSlice.end) }
      : paragraphSlice
    if (candidate.content.length <= options.maxChars) {
      current = candidate
      continue
    }

    flushCurrent()
    current = paragraphSlice
  }

  flushCurrent()
  return chunks

  function flushCurrent(): void {
    if (!current) return
    pushChunk(current)
    current = undefined
  }

  function pushChunk(chunk: TextSlice): void {
    if (chunks.length === 0 || options.overlapChars <= 0) {
      chunks.push(chunk)
      return
    }

    const start = Math.max(0, chunk.start - options.overlapChars)
    chunks.push({ start, end: chunk.end, content: content.slice(start, chunk.end) })
  }
}

function paragraphSlices(content: string): TextSlice[] {
  const slices: TextSlice[] = []
  const separator = /\n\s*\n/g
  let start = 0
  for (const match of content.matchAll(separator)) {
    const end = match.index ?? 0
    push(start, end)
    start = end + match[0].length
  }
  push(start, content.length)
  return slices

  function push(sliceStart: number, sliceEnd: number): void {
    const slice = content.slice(sliceStart, sliceEnd)
    if (!slice.trim()) return
    slices.push({ content: slice, start: sliceStart, end: sliceEnd })
  }
}

function splitLargeParagraph(content: string, start: number, end: number, maxChars: number): TextSlice[] {
  const paragraph = content.slice(start, end)
  const sentences = [...paragraph.matchAll(/[^.!?]+[.!?]?\s*/g)]
    .map((match) => ({
      start: start + (match.index ?? 0),
      end: start + (match.index ?? 0) + match[0].length,
      content: match[0],
    }))
    .filter((sentence) => sentence.content.trim())
  const chunks: TextSlice[] = []
  let current: TextSlice | undefined

  for (const sentence of sentences.length ? sentences : [{ start, end, content: paragraph }]) {
    if (sentence.content.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = undefined
      }
      for (let index = sentence.start; index < sentence.end; index += maxChars) {
        const pieceEnd = Math.min(index + maxChars, sentence.end)
        chunks.push({ start: index, end: pieceEnd, content: content.slice(index, pieceEnd) })
      }
      continue
    }

    const candidate = current
      ? { start: current.start, end: sentence.end, content: content.slice(current.start, sentence.end) }
      : sentence
    if (candidate.content.length <= maxChars) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
    }
    current = sentence
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}
