import type { Asset, TranscriptInterval, TranscriptionResult } from '@use-crux/core'
import type { IngestParser, IngestPart, IngestWarning } from './types'

const VIDEO_INSTRUCTION =
  'Describe the visible factual content of this video for document indexing. Return only faithful plain text; do not claim audio facts you cannot observe.'

/** Video derivation uses only explicitly supplied native description and soundtrack transcription operations. */
export const videoParser: IngestParser = {
  name: 'video',
  formats: ['video'],
  async parse(input, ctx) {
    const describe = ctx.media?.describe
    const transcribe = ctx.media?.transcribe
    if (!describe && !transcribe) {
      throw new Error(`Video source "${input.sourceId}" requires ParserOptions.media.describe, media.transcribe, or both.`)
    }
    const asset: Asset = input.asset ?? {
      type: 'data', data: input.bytes.slice(), mediaType: videoMediaType(input), ...(input.title ? { filename: input.title } : {}),
    }
    const parts: IngestPart[] = []
    if (describe) {
      const result = await describe({ messages: [{ role: 'user', content: [
        { type: 'text', text: VIDEO_INSTRUCTION },
        { type: 'video', source: asset, mediaType: asset.mediaType },
      ] }], maxOutputTokens: 2000 })
      const text = result.text.trim()
      if (!text) throw new Error(`Video source "${input.sourceId}" returned empty text from media.describe.`)
      parts.push({ id: 'video:visual:1', kind: 'text', role: 'paragraph', content: text })
    }
    if (transcribe) parts.push(...transcriptParts(await transcribe({ audio: asset }), input.sourceId))
    const mode = describe && transcribe ? 'visual and soundtrack' : describe ? 'visual only' : 'soundtrack only'
    const warnings: IngestWarning[] = [{ code: 'parser_warning', message: `Video derivation used ${mode} evidence.` }]
    return { parts, warnings, metadata: { derivationMode: mode.replaceAll(' ', '-') } }
  },
}

function transcriptParts(result: TranscriptionResult<unknown, unknown, unknown>, sourceId: string): IngestPart[] {
  const text = result.text.trim()
  if (!text) throw new Error(`Video source "${sourceId}" returned empty text from media.transcribe.`)
  if (!Array.isArray(result.segments)) throw new Error(`Video source "${sourceId}" returned invalid segments from media.transcribe.`)
  if (result.segments.length === 0) return [{ id: 'video:soundtrack:1', kind: 'text', role: 'paragraph', content: text }]
  let previousEnd = 0
  return result.segments.map((segment: TranscriptInterval, index) => {
    if (!segment.text.trim() || !Number.isFinite(segment.startSecond) || !Number.isFinite(segment.endSecond) ||
      segment.startSecond < previousEnd || segment.endSecond < segment.startSecond) {
      throw new Error(`Video source "${sourceId}" returned invalid seconds segments from media.transcribe.`)
    }
    previousEnd = segment.endSecond
    return { id: `video:soundtrack:${index + 1}`, kind: 'text', role: 'paragraph', content: segment.text.trim(),
      sourceLocation: { type: 'time', unit: 'seconds', start: segment.startSecond, end: segment.endSecond } }
  })
}

function videoMediaType(input: Parameters<IngestParser['parse']>[0]): string {
  const known = input.asset?.mediaType ?? input.metadata?.contentType ?? input.metadata?.mediaType
  if (typeof known === 'string' && known.split(';', 1)[0]?.startsWith('video/')) return known.split(';', 1)[0]!
  const title = input.title?.toLowerCase() ?? ''
  if (title.endsWith('.webm')) return 'video/webm'
  if (title.endsWith('.mov')) return 'video/quicktime'
  if (title.endsWith('.mkv')) return 'video/x-matroska'
  return 'video/mp4'
}
