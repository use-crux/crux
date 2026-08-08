import { createHash } from 'node:crypto'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import { load as loadHtml } from 'cheerio'
import mammoth from 'mammoth'
import type { IngestedDocument, ListBlock, ListItem, ParserIdentity, SourceCoordinate, TableCell, TextBlock } from '@use-crux/core/indexing'

const MAMMOTH_PRODUCER: ParserIdentity = {
  kind: 'parser',
  name: 'mammoth',
  version: '1.12.0',
  adapterVersion: '2',
}
const MAMMOTH_IDENTITY = `${MAMMOTH_PRODUCER.kind}:${MAMMOTH_PRODUCER.name}:${MAMMOTH_PRODUCER.version}:${MAMMOTH_PRODUCER.adapterVersion}`
const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface MammothMessage {
  readonly type?: string
  readonly message: string
}

/** Convert a DOCX through Mammoth into truthful schema-2 document blocks. */
export async function parseDocxDocument(input: {
  readonly bytes: Uint8Array
  readonly mediaType?: string
}): Promise<IngestedDocument> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(input.bytes) })
  return adaptMammothDocxResult({
    bytes: input.bytes,
    mediaType: input.mediaType,
    html: result.value,
    messages: result.messages,
  })
}

/** Adapt Mammoth's retained HTML facts without claiming DOCX package-part locations. */
export function adaptMammothDocxResult(input: {
  readonly bytes: Uint8Array
  readonly html: string
  readonly messages?: readonly MammothMessage[]
  readonly mediaType?: string
}): IngestedDocument {
  const documentSha256 = sha256(input.bytes)
  const coordinate: SourceCoordinate = { kind: 'document', documentSha256 }
  const blocks = mammothBlocks(input.html, documentSha256, coordinate)

  return validateIngestedDocument({
    schemaVersion: 2,
    source: {
      documentSha256,
      mediaType: input.mediaType ?? DOCX_MEDIA_TYPE,
      format: 'docx',
    },
    producer: MAMMOTH_PRODUCER,
    metadata: {},
    blocks,
    assets: [],
    diagnostics: (input.messages ?? []).map((message) => ({
      code: 'partial-extraction' as const,
      severity: 'warning' as const,
      message: message.message,
      coordinate,
      producer: MAMMOTH_PRODUCER,
    })),
  })
}

function mammothBlocks(html: string, documentSha256: string, coordinate: SourceCoordinate): IngestedDocument['blocks'] {
  const $ = loadHtml(html)
  const blocks: IngestedDocument['blocks'][number][] = []
  const headingPath: string[] = []
  let blockNumber = 0

  $('body')
    .children()
    .each((_, element) => {
      const tag = element.tagName.toLowerCase()

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1))
        const text = normalizedText($(element).text())
        if (!text) {
          return
        }
        headingPath.splice(level - 1)
        headingPath[level - 1] = text
        blocks.push(textBlock({ id: nextBlockId(), coordinate, headingPath, role: 'heading', text, level }))
        return
      }

      if (tag === 'table') {
        const table = tableFacts($, element)
        if (!table.rows.length) {
          return
        }
        const id = nextBlockId()
        blocks.push({
          id,
          kind: 'table',
          coordinate,
          headingPath: headingPath.filter(Boolean),
          producer: MAMMOTH_PRODUCER,
          columns: table.columns,
          headerRows: table.headerRows,
          rows: table.rows.map((row) => row.map((cell) => tableCell({ id, coordinate, ...cell }))),
        })
        return
      }

      if (tag === 'ol' || tag === 'ul') {
        const id = nextBlockId()
        blocks.push(listBlock($, element, id, coordinate, headingPath))
        return
      }

      const text = normalizedText($(element).text())
      if (!text) {
        return
      }
      blocks.push(textBlock({
        id: nextBlockId(),
        coordinate,
        headingPath,
        role: tag === 'pre' || tag === 'code' ? 'code' : 'paragraph',
        text,
      }))
    })

  if (blocks.length === 0) {
    const text = normalizedText($.root().text())
    if (text) {
      blocks.push(textBlock({ id: docxId(documentSha256, 'block:1'), coordinate, headingPath: [], role: 'paragraph', text }))
    }
  }

  return blocks

  function nextBlockId(): string {
    blockNumber += 1
    return docxId(documentSha256, `block:${blockNumber}`)
  }
}

function listBlock(
  $: ReturnType<typeof loadHtml>,
  element: Parameters<ReturnType<typeof loadHtml>>[0],
  id: string,
  coordinate: SourceCoordinate,
  headingPath: readonly string[],
): ListBlock {
  const items: ListItem[] = []

  $(element)
    .children('li')
    .each((itemIndex, item) => {
      const itemId = `${id}:item:${itemIndex + 1}`
      const blocks: (TextBlock | ListBlock)[] = []
      let bufferedText = ''
      let textIndex = 0
      const flushText = () => {
        const text = normalizedText(bufferedText)
        bufferedText = ''
        if (text) {
          textIndex += 1
          blocks.push(textBlock({ id: `${itemId}:text:${textIndex}`, coordinate, headingPath, role: 'paragraph', text }))
        }
      }
      $(item)
        .contents()
        .each((childIndex, child) => {
          const childId = `${itemId}:child:${childIndex + 1}`
          if (child.type === 'tag' && (child.tagName === 'ol' || child.tagName === 'ul')) {
            flushText()
            blocks.push(listBlock($, child, childId, coordinate, headingPath))
            return
          }
          bufferedText += $(child).text()
        })
      flushText()
      items.push({ id: itemId, coordinate, producer: MAMMOTH_PRODUCER, blocks })
    })

  return {
    id,
    kind: 'list',
    coordinate,
    headingPath: headingPath.filter(Boolean),
    producer: MAMMOTH_PRODUCER,
    ordered: $(element).is('ol'),
    items,
  }
}

function tableFacts(
  $: ReturnType<typeof loadHtml>,
  element: Parameters<ReturnType<typeof loadHtml>>[0],
): { readonly columns: readonly string[]; readonly headerRows: number; readonly rows: readonly (readonly TableCellFact[])[] } {
  const sourceRows: { readonly cells: readonly TableCellFact[]; readonly allHeaders: boolean }[] = []
  const activeRowSpans = new Map<number, number>()

  $(element)
    .children('thead,tbody,tfoot')
    .each((_, row) => {
      $(row)
        .children('tr')
        .each((__, nestedRow) => {
          sourceRows.push(readTableRow($, nestedRow, activeRowSpans, sourceRows.length + 1))
        })
    })
  $(element)
    .children('tr')
    .each((_, row) => {
      sourceRows.push(readTableRow($, row, activeRowSpans, sourceRows.length + 1))
    })

  const headerRows = sourceRows.findIndex((row) => !row.allHeaders)
  const establishedHeaderRows = headerRows === -1 ? sourceRows.length : headerRows
  return {
    columns: establishedHeaderRows > 0 ? sourceRows[0]?.cells.map((cell) => cell.value) ?? [] : [],
    headerRows: establishedHeaderRows,
    rows: sourceRows.map((row) => row.cells),
  }
}

interface TableCellFact {
  readonly value: string
  readonly row: number
  readonly column: number
  readonly rowSpan: number
  readonly columnSpan: number
}

function readTableRow(
  $: ReturnType<typeof loadHtml>,
  element: Parameters<ReturnType<typeof loadHtml>>[0],
  activeRowSpans: Map<number, number>,
  row: number,
): { readonly cells: readonly TableCellFact[]; readonly allHeaders: boolean } {
  const cells: TableCellFact[] = []
  let column = 1

  $(element)
    .children('th,td')
    .each((_, cell) => {
      while (activeRowSpans.has(column)) {
        column += 1
      }
      const columnSpan = span($(cell).attr('colspan'))
      const rowSpan = span($(cell).attr('rowspan'))
      cells.push({ value: normalizedText($(cell).text()), row: 0, column, rowSpan, columnSpan })
      if (rowSpan > 1) {
        for (let offset = 0; offset < columnSpan; offset += 1) {
          activeRowSpans.set(column + offset, rowSpan)
        }
      }
      column += columnSpan
    })

  for (const [activeColumn, remaining] of activeRowSpans) {
    if (remaining === 1) {
      activeRowSpans.delete(activeColumn)
    } else {
      activeRowSpans.set(activeColumn, remaining - 1)
    }
  }

  return {
    cells: cells.map((cell) => ({ ...cell, row })),
    allHeaders: cells.length > 0 && $(element).children('th').length === cells.length,
  }
}

function span(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function tableCell(input: {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly value: string
  readonly row: number
  readonly column: number
  readonly rowSpan: number
  readonly columnSpan: number
}): TableCell {
  const id = `${input.id}:row:${input.row}:column:${input.column}`
  return {
    id,
    coordinate: input.coordinate,
    producer: MAMMOTH_PRODUCER,
    row: input.row,
    column: input.column,
    rowSpan: input.rowSpan,
    columnSpan: input.columnSpan,
    blocks: [textBlock({ id: `${id}:text`, coordinate: input.coordinate, headingPath: [], role: 'paragraph', text: input.value })],
  }
}

function textBlock(input: {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly headingPath: readonly string[]
  readonly role: TextBlock['role']
  readonly text: string
  readonly level?: number
}): TextBlock {
  return {
    id: input.id,
    kind: 'text',
    coordinate: input.coordinate,
    headingPath: input.headingPath.filter(Boolean),
    producer: MAMMOTH_PRODUCER,
    role: input.role,
    text: input.text,
    ...(input.level === undefined ? {} : { level: input.level }),
    inlines: [],
  }
}

function docxId(documentSha256: string, structuralPath: string): string {
  return `docx:${documentSha256}:${MAMMOTH_IDENTITY}:${structuralPath}`
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
