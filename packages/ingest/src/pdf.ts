import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Asset } from '@use-crux/core'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import type {
  ApplicationOperationProducer,
  DocumentProducer,
  IngestDiagnostic,
  IngestedDocument,
  ListBlock,
  ParserIdentity,
  SourceCoordinate,
  TableBlock,
  TableCell,
  TextBlock,
} from '@use-crux/core/indexing'
import type {
  IngestPageBlock,
  IngestPagePart,
  IngestPart,
  IngestMediaOperations,
  IngestWarning,
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

const PDF_INSPECTOR_PRODUCER: ParserIdentity = {
  kind: 'parser',
  name: 'pdf-inspector',
  version: '1.12.0',
  adapterVersion: '2',
}
const PDFJS_PRODUCER: ParserIdentity = {
  kind: 'parser',
  name: 'pdfjs-dist',
  version: '5.7.284',
  adapterVersion: '2',
}

/** Parse a PDF and project its established facts into the schema-2 contract. */
export async function parsePdfDocument(input: {
  readonly bytes: Uint8Array
  readonly mediaType?: string
  readonly media?: IngestMediaOperations
  /** Required before application-derived visual text may become retrievable. */
  readonly mediaProducer?: ApplicationOperationProducer
}): Promise<IngestedDocument> {
  const warnings: IngestWarning[] = []
  const parsed = await parsePdf({
    bytes: input.bytes,
    format: 'pdf',
    sourceId: 'schema-2-pdf',
    namespace: 'schema-2',
  }, {
    warn: (warning) => warnings.push(warning),
    ...(input.mediaProducer ? { media: input.media } : {}),
  })
  return adaptPdfParseResult({
    bytes: input.bytes,
    mediaType: input.mediaType,
    mediaProducer: input.mediaProducer,
    parsed: { ...parsed, warnings: [...(parsed.warnings ?? []), ...warnings] },
  })
}

/**
 * Project legacy PDF parse facts without changing the public loader contract.
 * Page ordinals remain parser facts; every schema ID below is adapter-derived.
 */
export function adaptPdfParseResult(input: {
  readonly bytes: Uint8Array
  readonly mediaType?: string
  readonly mediaProducer?: ApplicationOperationProducer
  readonly parsed: ParseResult
}): IngestedDocument {
  const documentSha256 = sha256(input.bytes)
  const fallback = fallbackWarning(input.parsed.warnings)
  const pageProducer = fallback ? PDFJS_PRODUCER : PDF_INSPECTOR_PRODUCER
  const blocks = input.parsed.parts.flatMap((part) => {
    if (part.kind !== 'page') {
      return []
    }
    return [pdfPageBlock({ documentSha256, page: part, pageProducer, mediaProducer: input.mediaProducer })]
  })
  const diagnostics = pdfDiagnostics(input.parsed.warnings, fallback, pageProducer)

  return validateIngestedDocument({
    schemaVersion: 2,
    source: { documentSha256, mediaType: input.mediaType ?? 'application/pdf', format: 'pdf' },
    producer: pageProducer,
    metadata: input.parsed.title ? { title: input.parsed.title } : {},
    blocks,
    assets: [],
    diagnostics,
  })
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
    await loadingTask.destroy().catch(() => undefined)
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
    } catch {
      const part = emptyPagePart(pageNumber)
      warnTextlessPage(ctx, input.sourceId, part, 'media.describe failed')
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

function pdfPageBlock(input: {
  readonly documentSha256: string
  readonly page: IngestPagePart
  readonly pageProducer: ParserIdentity
  readonly mediaProducer?: ApplicationOperationProducer
}): IngestedDocument['blocks'][number] {
  const visual = input.page.id.endsWith(':visual')
  const producer = visual && input.mediaProducer ? input.mediaProducer : input.pageProducer
  const coordinate: SourceCoordinate = { kind: 'page', page: input.page.pageNumber }
  const path = visual && input.mediaProducer
    ? `page:${input.page.pageNumber}:derived`
    : `page:${input.page.pageNumber}`
  const id = pdfId(input.documentSha256, producer, path)
  const blocks = visual
    ? input.mediaProducer && input.page.content
      ? [pageText({ id: `${id}:text:1`, coordinate, producer, text: input.page.content })]
      : []
    : input.page.blocks?.map((block, index) => pdfLayoutBlock({
        documentSha256: input.documentSha256,
        page: input.page.pageNumber,
        block,
        ordinal: index + 1,
        producer,
      })) ?? fallbackText(input.page, id, coordinate, producer)

  return {
    id,
    kind: 'page',
    coordinate,
    headingPath: [],
    producer,
    page: input.page.pageNumber,
    blocks,
  }
}

function fallbackText(
  page: IngestPagePart,
  pageId: string,
  coordinate: SourceCoordinate,
  producer: DocumentProducer,
): (TextBlock | ListBlock | TableBlock)[] {
  if (!page.content) {
    return []
  }
  return [pageText({ id: `${pageId}:text:1`, coordinate, producer, text: page.content })]
}

function pdfLayoutBlock(input: {
  readonly documentSha256: string
  readonly page: number
  readonly block: IngestPageBlock
  readonly ordinal: number
  readonly producer: DocumentProducer
}): TextBlock | ListBlock | TableBlock {
  const coordinate = pdfBlockCoordinate(input.page, input.ordinal, input.block)
  const id = pdfId(input.documentSha256, input.producer, `page:${input.page}:block:${input.ordinal}`)
  const headingPath = input.block.headingPath ?? []

  if (input.block.kind === 'table') {
    const headerRows = input.block.columns ? 1 : 0
    return {
      id,
      kind: 'table',
      coordinate,
      headingPath,
      producer: input.producer,
      columns: input.block.columns ?? [],
      headerRows,
      rows: input.block.rows.map((row, rowIndex) => row.map((value, columnIndex) => tableCell({
        id: `${id}:row:${rowIndex + headerRows + 1}:column:${columnIndex + 1}`,
        coordinate,
        producer: input.producer,
        row: rowIndex + headerRows + 1,
        column: columnIndex + 1,
        value,
      }))),
    }
  }

  if (input.block.role === 'list') {
    return {
      id,
      kind: 'list',
      coordinate,
      headingPath,
      producer: input.producer,
      ordered: /^\s*\d+[.)]\s/.test(input.block.content),
      items: [{
        id: `${id}:item:1`,
        coordinate,
        producer: input.producer,
        blocks: [pageText({ id: `${id}:item:1:text:1`, coordinate, producer: input.producer, text: input.block.content })],
      }],
    }
  }

  return pageText({
    id,
    coordinate,
    producer: input.producer,
    headingPath,
    text: input.block.content,
    role: input.block.role === 'other' ? 'note' : input.block.role,
    level: input.block.role === 'heading' ? headingLevel(input.block.content) : undefined,
  })
}

function pageText(input: {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
  readonly text: string
  readonly headingPath?: readonly string[]
  readonly role?: TextBlock['role']
  readonly level?: number
}): TextBlock {
  return {
    id: input.id,
    kind: 'text',
    coordinate: input.coordinate,
    headingPath: input.headingPath ?? [],
    producer: input.producer,
    role: input.role ?? 'paragraph',
    text: input.text,
    ...(input.level ? { level: input.level } : {}),
    inlines: [],
  }
}

function tableCell(input: {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
  readonly row: number
  readonly column: number
  readonly value: string
}): TableCell {
  return {
    id: input.id,
    coordinate: input.coordinate,
    producer: input.producer,
    row: input.row,
    column: input.column,
    rowSpan: 1,
    columnSpan: 1,
    blocks: [pageText({ id: `${input.id}:text`, coordinate: input.coordinate, producer: input.producer, text: input.value })],
    displayedValue: input.value,
  }
}

function pdfBlockCoordinate(page: number, ordinal: number, block: IngestPageBlock): SourceCoordinate {
  return {
    kind: 'page-block',
    page,
    block: ordinal,
    ...(block.sourceRange ? { start: block.sourceRange.start, end: block.sourceRange.end } : {}),
  }
}

function pdfId(documentSha256: string, producer: DocumentProducer, structuralPath: string): string {
  return `pdf:${documentSha256}:${producerIdentity(producer)}:${structuralPath}`
}

function producerIdentity(producer: DocumentProducer): string {
  if (producer.kind === 'parser') {
    return `${producer.kind}:${producer.name}:${producer.version}:${producer.adapterVersion}`
  }
  return `${producer.kind}:${producer.operation}:${producer.identity}:${producer.version}`
}

function headingLevel(markdown: string): number | undefined {
  const match = /^(?: {0,3})(#{1,6})(?:\s|$)/.exec(markdown)
  return match?.[1]?.length
}

function fallbackWarning(warnings: readonly IngestWarning[] | undefined): FallbackReason | undefined {
  const warning = warnings?.find((candidate) => candidate.code === 'parser_warning'
    && isRecord(candidate.metadata)
    && candidate.metadata.primaryParser === 'pdf-inspector'
    && candidate.metadata.fallbackParser === 'pdfjs-dist')
  const reason = warning?.metadata?.reason
  return reason === 'backend_unavailable' || reason === 'extraction_failed' || reason === 'invalid_result' ? reason : undefined
}

function pdfDiagnostics(
  warnings: readonly IngestWarning[] | undefined,
  fallback: FallbackReason | undefined,
  producer: ParserIdentity,
): IngestDiagnostic[] {
  const diagnostics: IngestDiagnostic[] = []
  if (fallback) {
    diagnostics.push({
      code: 'parser-downgrade',
      severity: 'warning',
      trigger: fallback === 'invalid_result' ? 'invalid-result' : fallback === 'backend_unavailable' ? 'unsupported-feature' : 'parser-crash',
      from: 'pdf-inspector',
      to: 'pdfjs-dist',
      producer,
    })
  }
  for (const warning of warnings ?? []) {
    if (warning.code !== 'partial_extraction') {
      continue
    }
    const page = pageNumberFromWarning(warning)
    diagnostics.push({
      code: 'partial-extraction',
      severity: 'warning',
      message: warning.message,
      ...(page ? { coordinate: { kind: 'page', page } as SourceCoordinate } : {}),
      producer,
    })
  }
  return diagnostics
}

function pageNumberFromWarning(warning: IngestWarning): number | undefined {
  const location = isRecord(warning.metadata) ? warning.metadata.sourceLocation : undefined
  return isRecord(location) && location.type === 'page' && typeof location.pageNumber === 'number'
    && Number.isInteger(location.pageNumber) && location.pageNumber > 0
    ? location.pageNumber
    : undefined
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
