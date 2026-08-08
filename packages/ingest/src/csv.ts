import { createHash } from 'node:crypto'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import { parse as parseCsv } from 'csv-parse/sync'
import type { IngestedDocument, ParserIdentity, SourceCoordinate, TableCell, TextBlock } from '@use-crux/core/indexing'

const CSV_PARSE_PRODUCER: ParserIdentity = {
  kind: 'parser',
  name: 'csv-parse',
  version: '6.2.1',
  adapterVersion: '2',
}
const CSV_PARSE_IDENTITY = `${CSV_PARSE_PRODUCER.kind}:${CSV_PARSE_PRODUCER.name}:${CSV_PARSE_PRODUCER.version}:${CSV_PARSE_PRODUCER.adapterVersion}`

/** Parse CSV into the incumbent exact logical cell matrix. */
export function parseCsvRows(text: string): string[][] {
  const records = parseCsv(text, { relax_column_count: true, skip_empty_lines: true }) as string[][]
  return records.map((row) => row.map((cell) => String(cell ?? '')))
}

/**
 * Adapt csv-parse's exact logical matrix into Core's schema-2 ingest contract.
 * CSV has logical records only, so no physical byte or line locations are made.
 */
export function parseCsvDocument(input: {
  readonly bytes: Uint8Array
  readonly mediaType?: string
}): IngestedDocument {
  const documentSha256 = sha256(input.bytes)
  const rows = parseCsvRows(new TextDecoder('utf-8').decode(input.bytes))
  const coordinate: SourceCoordinate = { kind: 'logical-table', rowStart: 1, rowEnd: rows.length }
  const tableId = csvId(documentSha256, 'table:1')

  return validateIngestedDocument({
    schemaVersion: 2,
    source: {
      documentSha256,
      mediaType: input.mediaType ?? 'text/csv',
      format: 'csv',
    },
    producer: CSV_PARSE_PRODUCER,
    metadata: {},
    blocks: rows.length
      ? [
          {
            id: tableId,
            kind: 'table',
            coordinate,
            headingPath: [],
            producer: CSV_PARSE_PRODUCER,
            columns: rows[0] ?? [],
            headerRows: 1,
            rows: rows.map((row, rowIndex) =>
              row.map((value, columnIndex) => csvCell({ tableId, value, row: rowIndex + 1, column: columnIndex + 1 })),
            ),
          },
        ]
      : [],
    assets: [],
    diagnostics: [],
  })
}

function csvCell(input: { readonly tableId: string; readonly value: string; readonly row: number; readonly column: number }): TableCell {
  const coordinate: SourceCoordinate = { kind: 'logical-table', rowStart: input.row, rowEnd: input.row }
  const id = `${input.tableId}:row:${input.row}:column:${input.column}`
  const text: TextBlock = {
    id: `${id}:text`,
    kind: 'text',
    coordinate,
    headingPath: [],
    producer: CSV_PARSE_PRODUCER,
    role: 'paragraph',
    text: input.value,
    inlines: [],
  }

  return {
    id,
    coordinate,
    producer: CSV_PARSE_PRODUCER,
    row: input.row,
    column: input.column,
    rowSpan: 1,
    columnSpan: 1,
    blocks: [text],
  }
}

function csvId(documentSha256: string, structuralPath: string): string {
  return `csv:${documentSha256}:${CSV_PARSE_IDENTITY}:${structuralPath}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
