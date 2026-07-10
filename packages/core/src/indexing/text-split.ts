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
    return [{ start: 0, end: document.content.length, reason: 'single-segment' }]
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
  if (content.length <= options.maxChars) {
    return [content]
  }

  const paragraphs = content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content]) {
    if (paragraph.length > options.maxChars) {
      flushCurrent()
      for (const piece of splitLargeParagraph(paragraph, options.maxChars)) {
        pushChunk(piece)
      }
      continue
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= options.maxChars) {
      current = candidate
      continue
    }

    flushCurrent()
    current = paragraph
  }

  flushCurrent()
  return chunks

  function flushCurrent(): void {
    if (!current) return
    pushChunk(current)
    current = ''
  }

  function pushChunk(chunk: string): void {
    if (chunks.length === 0 || options.overlapChars <= 0) {
      chunks.push(chunk)
      return
    }

    const overlap = chunks[chunks.length - 1].slice(-Math.min(options.overlapChars, chunks[chunks.length - 1].length))
    chunks.push(overlap ? `${overlap}${chunk}` : chunk)
  }
}

function splitLargeParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph
    .match(/[^.!?]+[.!?]?\s*/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [paragraph]
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let index = 0; index < sentence.length; index += maxChars) {
        chunks.push(sentence.slice(index, index + maxChars))
      }
      continue
    }

    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length <= maxChars) {
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
