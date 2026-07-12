import type { Asset } from '@use-crux/core'
import type { IngestPart, ParseContext, ParseInput, ParseResult } from './types'
import { observeIngestMediaCall } from './media-observation'

export async function parsePdf(input: ParseInput, ctx: Pick<ParseContext, 'warn' | 'media'>): Promise<ParseResult> {
  const bytes = input.bytes
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = toPlainUint8Array(bytes)
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
  })

  try {
    const document = await loadingTask.promise
    const parts: IngestPart[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = normalizePdfPageText(
        textContent.items
          .map((item) => {
            if (!('str' in item)) return ''
            return item.hasEOL ? `${item.str}\n` : `${item.str} `
          })
          .join(''),
      )

      if (pageText) {
        parts.push({
          id: `pdf:page:${pageNumber}`,
          kind: 'page',
          pageNumber,
          sourceLocation: { type: 'page', pageNumber },
          content: pageText,
        })
        continue
      }

      if (ctx.media?.describe) {
        const asset: Asset = input.asset ?? {
          type: 'data', data: bytes.slice(), mediaType: 'application/pdf', ...(input.title ? { filename: input.title } : {}),
        }
        const describe = ctx.media.describe
        const generated = await observeIngestMediaCall(
          'media.describe',
          () =>
            describe({
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: `Extract faithful plain text and visible factual content from page ${pageNumber} of this PDF for document indexing. Return only content from that one page.` },
                  { type: 'file', source: asset, mediaType: 'application/pdf', ...(input.title ? { filename: input.title } : {}) },
                ],
              }],
              maxOutputTokens: 2000,
            }),
          { sourceId: input.sourceId, pageNumber },
        )
        if (generated.text.trim()) {
          parts.push({
            id: `pdf:page:${pageNumber}:visual`,
            kind: 'page',
            pageNumber,
            sourceLocation: { type: 'page', pageNumber },
            content: generated.text.trim(),
          })
          continue
        }
        throw new Error(`PDF source "${input.sourceId}" page ${pageNumber} returned empty text from media.describe.`)
      }

      throw new Error(`PDF source "${input.sourceId}" page ${pageNumber} has no meaningful text and requires ParserOptions.media.describe.`)
    }

    const metadata = await document.getMetadata().catch(() => undefined)
    const title = normalizeOptionalString(readMetadataTitle(metadata?.info))

    return {
      ...(title ? { title } : {}),
      parts,
    }
  } finally {
    await loadingTask.destroy()
  }
}

function normalizePdfPageText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readMetadataTitle(info: unknown): unknown {
  if (!info || typeof info !== 'object') {
    return undefined
  }

  return (info as Record<string, unknown>).Title
}

function toPlainUint8Array(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}
