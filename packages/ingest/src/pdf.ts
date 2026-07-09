import type { IngestPart, ParseContext, ParseResult } from './types'

export async function parsePdf(bytes: Uint8Array, ctx: Pick<ParseContext, 'warn' | 'ocr'>): Promise<ParseResult> {
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
          content: pageText,
        })
        continue
      }

      if (ctx.ocr) {
        const ocr = await ctx.ocr.extract({ bytes, sourceId: 'pdf', pageNumber, mimeType: 'application/pdf' })
        if (ocr.text.trim()) {
          parts.push({
            id: `pdf:page:${pageNumber}:ocr`,
            kind: 'page',
            pageNumber,
            content: ocr.text,
            metadata: {
              ocr: ctx.ocr.name,
              ...(ocr.confidence !== undefined ? { confidence: ocr.confidence } : {}),
              ...(ocr.metadata ?? {}),
            },
          })
          continue
        }
      }

      ctx.warn({
        code: 'image_ocr_unavailable',
        message: `PDF page ${pageNumber} did not contain extractable text.`,
        partId: `pdf:page:${pageNumber}`,
      })
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
  if (bytes.constructor === Uint8Array) {
    return bytes
  }

  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
