import { Buffer } from 'node:buffer'
import type { Asset } from '@use-crux/core'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import type {
  IngestPageBlock,
  IngestPagePart,
  IngestPart,
  ParseContext,
  ParseInput,
  ParseResult,
} from './types'
import { observeIngestMediaCall } from './media-observation'

type PdfContext = Pick<ParseContext, 'warn' | 'media'>
type FallbackReason = 'backend_unavailable' | 'extraction_failed' | 'invalid_result'

interface NativePage {
  readonly page: number
  readonly markdown: string
  readonly needsOcr: boolean
}

export async function parsePdf(input: ParseInput, ctx: PdfContext): Promise<ParseResult> {
  const bytes = input.bytes
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: toPlainUint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
  })

  try {
    const document = await loadingTask.promise
    const metadata = await Promise.resolve().then(() => document.getMetadata()).catch(() => undefined)
    const title = normalizeOptionalString(readMetadataTitle(metadata?.info))
    let fallbackReason: FallbackReason | undefined
    let nativePages: readonly NativePage[] | undefined

    try {
      const native = await import('@firecrawl/pdf-inspector')
      let result: unknown
      try {
        result = await native.extractPagesMarkdown(Buffer.from(bytes))
      } catch {
        fallbackReason = 'extraction_failed'
      }
      if (!fallbackReason) {
        nativePages = validateNativePages(result, document.numPages)
        if (!nativePages) fallbackReason = 'invalid_result'
      }
    } catch {
      fallbackReason = 'backend_unavailable'
    }

    if (nativePages) {
      const parts: IngestPart[] = []
      for (const nativePage of nativePages) {
        const pageNumber = nativePage.page + 1
        if (nativePage.needsOcr) {
          parts.push(await materializeTextlessPage(input, ctx, pageNumber))
          continue
        }
        const content = nativePage.markdown.trim()
        const part: IngestPagePart = {
          id: `pdf:page:${pageNumber}`,
          kind: 'page',
          pageNumber,
          sourceLocation: { type: 'page', pageNumber },
          content,
        }
        const blocks = content ? parsePageBlocks(content, part.id) : []
        parts.push(blocks.length > 0 ? { ...part, blocks } : part)
      }
      return { ...(title ? { title } : {}), parts }
    }

    const parts = await extractFallbackPages(document, input, ctx)
    warnFallback(ctx, input.sourceId, fallbackReason ?? 'invalid_result')
    return { ...(title ? { title } : {}), parts }
  } finally {
    await loadingTask.destroy()
  }
}

function validateNativePages(value: unknown, physicalCount: number): readonly NativePage[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.pages) || value.pages.length !== physicalCount) return undefined
  const pages: NativePage[] = []
  for (let ordinal = 0; ordinal < value.pages.length; ordinal++) {
    const page = value.pages[ordinal]
    if (!isRecord(page)
      || typeof page.page !== 'number'
      || !Number.isFinite(page.page)
      || !Number.isInteger(page.page)
      || page.page !== ordinal
      || typeof page.markdown !== 'string'
      || typeof page.needsOcr !== 'boolean') return undefined
    pages.push({ page: page.page, markdown: page.markdown, needsOcr: page.needsOcr })
  }
  return pages
}

async function extractFallbackPages(
  document: { readonly numPages: number; getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> },
  input: ParseInput,
  ctx: PdfContext,
): Promise<IngestPart[]> {
  const parts: IngestPart[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const pageText = normalizePdfPageText(textContent.items.map(readPdfTextItem).join(''))
    parts.push(pageText ? pagePart(pageNumber, pageText) : await materializeTextlessPage(input, ctx, pageNumber))
  }
  return parts
}

function readPdfTextItem(item: unknown): string {
  if (!isRecord(item) || typeof item.str !== 'string') return ''
  return item.hasEOL === true ? `${item.str}\n` : `${item.str} `
}

async function materializeTextlessPage(input: ParseInput, ctx: PdfContext, pageNumber: number): Promise<IngestPagePart> {
  const describe = ctx.media?.describe
  if (describe) {
    const asset: Asset = input.asset ?? {
      type: 'data', data: input.bytes.slice(), mediaType: 'application/pdf', ...(input.title ? { filename: input.title } : {}),
    }
    try {
      const generated = await observeIngestMediaCall(
        'media.describe',
        () => describe({
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
      const content = generated.text.trim()
      if (content) return { ...pagePart(pageNumber, content), id: `pdf:page:${pageNumber}:visual` }
      const part = emptyPagePart(pageNumber)
      warnTextlessPage(ctx, input.sourceId, part, 'media.describe returned empty text')
      return part
    } catch (error) {
      const part = emptyPagePart(pageNumber)
      const reason = error instanceof Error ? error.message : String(error)
      warnTextlessPage(ctx, input.sourceId, part, `media.describe failed: ${reason}`)
      return part
    }
  }
  const part = emptyPagePart(pageNumber)
  warnTextlessPage(ctx, input.sourceId, part, 'no media.describe operation was available')
  return part
}

function parsePageBlocks(markdown: string, pageId: string): IngestPageBlock[] {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const blocks: IngestPageBlock[] = []
  const headings: Array<{ depth: number; text: string }> = []

  for (const node of tree.children) {
    const range = readSourceRange(node)
    const raw = range ? markdown.slice(range.start, range.end) : ''
    if (!raw.trim()) continue
    const id = `${pageId}/block:${blocks.length}`

    if (node.type === 'heading') {
      const visible = normalizeHeading(mdastToString(node))
      if (!visible) {
        blocks.push(textBlock(id, 'other', raw, headings.map((entry) => entry.text), range, markdown))
        continue
      }
      while (headings.at(-1)?.depth !== undefined && headings.at(-1)!.depth >= node.depth) headings.pop()
      headings.push({ depth: node.depth, text: visible })
      blocks.push(textBlock(id, 'heading', raw, headings.map((entry) => entry.text), range, markdown))
      continue
    }

    const headingPath = headings.map((entry) => entry.text)
    if (node.type === 'table') {
      const rows = node.children.map((row) => row.children.map((cell) => mdastToString(cell)))
      const columns = rows.shift()
      if ((columns?.length ?? 0) === 0 && rows.length === 0) continue
      blocks.push({
        id, kind: 'table', content: raw, rows,
        ...(columns ? { columns } : {}),
        ...(headingPath.length > 0 ? { headingPath } : {}),
        ...exactRange(markdown, raw, range),
      })
      continue
    }

    if (!mdastToString(node).trim()) continue

    const role = node.type === 'paragraph' ? 'paragraph'
      : node.type === 'list' ? 'list'
        : node.type === 'code' ? 'code'
          : 'other'
    const content = node.type === 'list'
      ? node.children.map((item) => mdastToString(item).trim()).filter(Boolean).join('\n')
      : raw
    blocks.push(textBlock(id, role, content, headingPath, range, markdown))
  }
  return blocks
}

function textBlock(
  id: string,
  role: 'heading' | 'paragraph' | 'list' | 'code' | 'other',
  content: string,
  headingPath: string[],
  range: { start: number; end: number } | undefined,
  markdown: string,
): IngestPageBlock {
  return {
    id, kind: 'text', role, content,
    ...(headingPath.length > 0 ? { headingPath } : {}),
    ...exactRange(markdown, content, range),
  }
}

function readSourceRange(node: { readonly position?: { readonly start?: { readonly offset?: number }; readonly end?: { readonly offset?: number } } }): { start: number; end: number } | undefined {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  return typeof start === 'number' && typeof end === 'number' ? { start, end } : undefined
}

function exactRange(markdown: string, content: string, range: { start: number; end: number } | undefined): { sourceRange?: { start: number; end: number } } {
  return range && markdown.slice(range.start, range.end) === content ? { sourceRange: range } : {}
}

function normalizeHeading(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function warnFallback(ctx: Pick<ParseContext, 'warn'>, sourceId: string, reason: FallbackReason): void {
  ctx.warn({
    code: 'parser_warning',
    message: `PDF source "${sourceId}" used the pdfjs-dist fallback because layout-aware extraction was unavailable; document structure may be reduced.`,
    metadata: { primaryParser: 'pdf-inspector', fallbackParser: 'pdfjs-dist', reason },
  })
}

function warnTextlessPage(ctx: Pick<ParseContext, 'warn'>, sourceId: string, part: IngestPagePart, reason: string): void {
  ctx.warn({
    code: 'partial_extraction',
    message: `PDF source "${sourceId}" page ${part.pageNumber} was retained without content because ${reason}.`,
    partId: part.id,
    metadata: { pageNumber: part.pageNumber, sourceLocation: part.sourceLocation },
  })
}

function pagePart(pageNumber: number, content: string): IngestPagePart {
  return { id: `pdf:page:${pageNumber}`, kind: 'page', pageNumber, sourceLocation: { type: 'page', pageNumber }, content }
}

function emptyPagePart(pageNumber: number): IngestPagePart {
  return pagePart(pageNumber, '')
}

function normalizePdfPageText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readMetadataTitle(info: unknown): unknown {
  return isRecord(info) ? info.Title : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPlainUint8Array(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}
