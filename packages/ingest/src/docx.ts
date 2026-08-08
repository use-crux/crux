import { createHash } from 'node:crypto'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import { load as loadHtml } from 'cheerio'
import mammoth from 'mammoth'
import type { IngestedDocument, ParserIdentity, SourceCoordinate, TableCell, TextBlock } from '@use-crux/core/indexing'

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
    .find('h1,h2,h3,h4,h5,h6,p,li,pre,code,table')
    .each((_, element) => {
      const tag = element.tagName.toLowerCase()
      const id = docxId(documentSha256, `block:${++blockNumber}`)

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1))
        const text = normalizedText($(element).text())
        if (!text) {
          return
        }
        headingPath.splice(level - 1)
        headingPath[level - 1] = text
        blocks.push(textBlock({ id, coordinate, headingPath, role: 'heading', text, level }))
        return
      }

      if (tag === 'table') {
        const rows = tableRows($, element)
        if (!rows.length) {
          return
        }
        blocks.push({
          id,
          kind: 'table',
          coordinate,
          headingPath: headingPath.filter(Boolean),
          producer: MAMMOTH_PRODUCER,
          columns: rows[0] ?? [],
          headerRows: 1,
          rows: rows.map((row, rowIndex) =>
            row.map((value, columnIndex) => tableCell({ id, coordinate, value, row: rowIndex + 1, column: columnIndex + 1 })),
          ),
        })
        return
      }

      const text = normalizedText($(element).text())
      if (!text) {
        return
      }
      if (tag === 'li') {
        const itemId = `${id}:item:1`
        blocks.push({
          id,
          kind: 'list',
          coordinate,
          headingPath: headingPath.filter(Boolean),
          producer: MAMMOTH_PRODUCER,
          ordered: $(element).parent().is('ol'),
          items: [
            {
              id: itemId,
              coordinate,
              producer: MAMMOTH_PRODUCER,
              blocks: [textBlock({ id: `${itemId}:text:1`, coordinate, headingPath, role: 'paragraph', text })],
            },
          ],
        })
        return
      }

      blocks.push(textBlock({
        id,
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
}

function tableRows($: ReturnType<typeof loadHtml>, element: Parameters<ReturnType<typeof loadHtml>>[0]): string[][] {
  const rows: string[][] = []
  $(element)
    .find('tr')
    .each((_, row) => {
      const cells: string[] = []
      $(row)
        .find('th,td')
        .each((__, cell) => {
          cells.push(normalizedText($(cell).text()))
        })
      if (cells.length) {
        rows.push(cells)
      }
    })
  return rows
}

function tableCell(input: {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly value: string
  readonly row: number
  readonly column: number
}): TableCell {
  const id = `${input.id}:row:${input.row}:column:${input.column}`
  return {
    id,
    coordinate: input.coordinate,
    producer: MAMMOTH_PRODUCER,
    row: input.row,
    column: input.column,
    rowSpan: 1,
    columnSpan: 1,
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
