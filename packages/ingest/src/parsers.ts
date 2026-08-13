import ExcelJS from 'exceljs'
import { load as loadHtml } from 'cheerio'
import mammoth from 'mammoth'
import SSF from 'ssf'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import { deriveContent } from './document'
import { normalizeDocument } from './document'
import { normalizeIngestedDocument, validateIngestedDocument } from '@use-crux/core/indexing'
import { parseCsvRows } from './csv'
import { parseCsvDocument } from './csv'
import { parseDocxDocument } from './docx'
import { openIngestParseObservation } from './observability'
import { parsePdf } from './pdf'
import { parsePdfDocument } from './pdf'
import { parseXlsxDocument } from './xlsx'
import { imageParser } from './visual-image'
import { audioParser } from './audio'
import { videoParser } from './video'
import { adaptBuiltInParseResult, IngestEvidenceRequiredError } from './parse-result-schema-2'
import type {
  IngestDocument,
  IngestError,
  IngestFormat,
  IngestParser,
  IngestPart,
  IngestSpreadsheetMerge,
  IngestSpreadsheetRange,
  IngestSpreadsheetRow,
  IngestTablePart,
  IngestTextPart,
  IngestWarning,
  ParseInput,
  ParseResult,
  ParserOptions,
} from './types'

export async function parseDocument(input: {
  namespace: string
  sourceId: string
  bytes: Uint8Array
  asset?: import('@use-crux/core').Asset
  format: IngestFormat
  title?: string
  metadata?: Record<string, unknown>
  source?: IngestDocument['source']
  contentType?: string
  options?: ParserOptions
}): Promise<IngestDocument> {
  const parser = resolveParser(input.format, input.options)
  const warnings: IngestWarning[] = []
  const text = isTextLike(input.format) ? new TextDecoder('utf-8').decode(input.bytes) : undefined
  const parseObservation = openIngestParseObservation({
    parser: parser.name,
    format: input.format,
    namespace: input.namespace,
    sourceId: input.sourceId,
    byteLength: input.bytes.byteLength,
    ...(input.contentType ? { contentType: input.contentType } : {}),
  })

  return await parseObservation.withContext(async () => {
    try {
      const schema2Result = await parseSchema2Document(input, parser, warnings)
      if (schema2Result) {
        const metadata = {
          ...(input.metadata ?? {}),
          ...schema2Result.document.metadata,
          format: input.format,
          parser: parser.name,
        }
        const title = schema2Result.title ?? schema2Title(schema2Result.document.metadata) ?? input.title
        const document = normalizeIngestedDocument(schema2Result.document, {
          namespace: input.namespace,
          sourceId: input.sourceId,
          ...(input.source ? { source: input.source } : {}),
          ...(title ? { title } : {}),
        })
        parseObservation.end({ partCount: document.parts?.length ?? 0, warningCount: schema2Result.document.diagnostics.length })
        return {
          ...document,
          metadata,
          ...(warnings.length ? { warnings } : {}),
        } as IngestDocument
      }
      const parsed = await parser.parse(
        {
          bytes: input.bytes,
          ...(input.asset ? { asset: input.asset } : {}),
          ...(text !== undefined ? { text } : {}),
          format: input.format,
          sourceId: input.sourceId,
          source: input.source,
          namespace: input.namespace,
          title: input.title,
          metadata: input.metadata,
        },
        {
          media: input.options?.media,
          warn: (warning) => warnings.push(warning),
        },
      )
      warnings.push(...(parsed.warnings ?? []))

      const document = normalizeDocument({
        namespace: input.namespace,
        sourceId: input.sourceId,
        source: input.source,
        title: parsed.title ?? input.title,
        parts: parsed.parts,
        metadata: {
          ...(input.metadata ?? {}),
          ...(parsed.metadata ?? {}),
          format: input.format,
          parser: parser.name,
        },
        warnings,
      })
      parseObservation.end({
        partCount: document.parts.length,
        warningCount: warnings.length,
      })
      return document
    } catch (error) {
      const parsedError = toParseError(error, parser.name)
      parseObservation.error(parsedError, {
        partCount: 0,
        warningCount: warnings.length,
        phase: 'ingest.parse',
      })
      throw parsedError
    }
  })
}

function schema2Title(metadata: Readonly<Record<string, string | number | boolean>>): string | undefined {
  return typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : undefined
}

async function parseSchema2Document(
  input: Parameters<typeof parseDocument>[0],
  parser: IngestParser,
  warnings: IngestWarning[],
) {
  const custom = input.options?.parsers?.some((candidate) => candidate === parser)
  if (custom) {
    if (!parser.schema2) {
      throw new IngestEvidenceRequiredError(parser.name)
    }
    return {
      document: validateIngestedDocument(await parser.schema2.parse(
        parseInput(input),
        { media: input.options?.media, warn: (warning) => warnings.push(warning) },
      )),
    }
  }
  const mediaType = input.contentType?.split(';', 1)[0] ?? input.source?.mediaType
  if (input.format === 'csv') {
    return { document: await parseCsvDocument({ bytes: input.bytes, ...(mediaType ? { mediaType } : {}) }) }
  }
  if (input.format === 'docx') {
    return { document: await parseDocxDocument({ bytes: input.bytes, ...(mediaType ? { mediaType } : {}) }) }
  }
  if (input.format === 'xlsx' || input.format === 'xlsm') {
    return {
      document: await parseXlsxDocument({
        bytes: input.bytes,
        format: input.format,
        ...(mediaType ? { mediaType } : {}),
      }),
    }
  }
  if (input.format === 'pdf') {
    return {
      document: await parsePdfDocument({
        bytes: input.bytes,
        ...(mediaType ? { mediaType } : {}),
        media: input.options?.media,
        ...(input.options?.mediaProducers ? { mediaProducers: input.options.mediaProducers } : {}),
      }),
    }
  }
  const parsed = await parser.parse(parseInput(input), { media: input.options?.media, warn: (warning) => warnings.push(warning) })
  warnings.push(...(parsed.warnings ?? []))
  return {
    document: adaptBuiltInParseResult({
      bytes: input.bytes,
      format: input.format,
      result: parsed,
      ...(mediaType ? { mediaType } : {}),
      options: input.options,
    }),
    ...(parsed.title ? { title: parsed.title } : {}),
  }
}

function parseInput(input: Parameters<typeof parseDocument>[0]): ParseInput {
  const text = isTextLike(input.format) ? new TextDecoder('utf-8').decode(input.bytes) : undefined
  return {
    bytes: input.bytes,
    ...(input.asset ? { asset: input.asset } : {}),
    ...(text !== undefined ? { text } : {}),
    format: input.format,
    sourceId: input.sourceId,
    source: input.source,
    namespace: input.namespace,
    title: input.title,
    metadata: input.metadata,
  }
}

export function resolveParser(format: IngestFormat, options?: ParserOptions): IngestParser {
  const custom = options?.parsers?.find((parser) => parser.formats.includes(format))
  if (custom) return custom

  const builtin = builtInParsers.find((parser) => parser.formats.includes(format))
  return builtin ?? plainTextParser
}

export const plainTextParser: IngestParser = {
  name: 'text',
  formats: ['txt', 'unknown'],
  parse(input) {
    const content = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    const parts: IngestPart[] = content.trim()
      ? [
          {
            id: 'text:1',
            kind: 'text',
            role: 'paragraph',
            content,
          },
        ]
      : []
    return { parts }
  },
}

export const markdownParser: IngestParser = {
  name: 'markdown',
  formats: ['md'],
  parse(input) {
    const text = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    const tree = fromMarkdown(text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as MarkdownNode
    const parts: IngestPart[] = []
    const headingPath: string[] = []
    let counter = 0

    for (const child of tree.children ?? []) {
      if (child.type === 'heading') {
        const depth = typeof child.depth === 'number' ? child.depth : 1
        const heading = mdastToString(child).trim()
        headingPath.splice(depth - 1)
        headingPath[depth - 1] = heading
        parts.push({
          id: `md:text:${++counter}`,
          kind: 'text',
          role: 'heading',
          headingPath: headingPath.filter(Boolean),
          content: heading,
        })
        continue
      }

      if (child.type === 'table') {
        const rows = (child.children ?? []).map((row) => (row.children ?? []).map((cell) => mdastToString(cell).trim()))
        if (rows.length > 0) {
          const table: IngestTablePart = {
            id: `md:table:${++counter}`,
            kind: 'table',
            rows,
            columns: rows[0],
            content: renderRows(rows),
            metadata: { headingPath: headingPath.filter(Boolean) },
          }
          parts.push(table)
        }
        continue
      }

      const content = mdastToString(child).trim()
      if (content) {
        parts.push({
          id: `md:text:${++counter}`,
          kind: 'text',
          role: markdownRole(child.type),
          headingPath: headingPath.filter(Boolean),
          content,
        })
      }
    }

    return { parts }
  },
}

export const htmlParser: IngestParser = {
  name: 'html',
  formats: ['html'],
  parse(input) {
    const html = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    return parseHtmlParts(html, 'html')
  },
}

export const pdfParser: IngestParser = {
  name: 'pdf',
  formats: ['pdf'],
  async parse(input, ctx) {
    return parsePdf(input, ctx)
  },
}

export const csvParser: IngestParser = {
  name: 'csv',
  formats: ['csv'],
  parse(input) {
    const text = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    const rows = parseCsvRows(text)
    const table: IngestTablePart = {
      id: 'csv:table:1',
      kind: 'table',
      rows,
      columns: rows[0],
      rowStart: 1,
      rowEnd: rows.length,
      content: renderRows(rows),
    }
    return { parts: rows.length ? [table] : [] }
  },
}

export const jsonParser: IngestParser = {
  name: 'json',
  formats: ['json'],
  parse(input) {
    const text = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    const value = JSON.parse(text) as unknown
    const parts: IngestPart[] = []
    collectJsonParts(value, '$', parts)
    return { parts }
  },
}

export const docxParser: IngestParser = {
  name: 'docx',
  formats: ['docx'],
  async parse(input, ctx) {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(input.bytes) })
    for (const message of result.messages ?? []) {
      ctx.warn({
        code: 'parser_warning',
        message: message.message,
        metadata: { type: message.type },
      })
    }
    return parseHtmlParts(result.value, 'docx')
  },
}

export const xlsxParser: IngestParser = {
  name: 'xlsx',
  formats: ['xlsx', 'xlsm'],
  async parse(input, ctx) {
    const workbook = new ExcelJS.Workbook()
    const workbookBytes = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    )
    await workbook.xlsx.load(workbookBytes as Parameters<typeof workbook.xlsx.load>[0])
    const parts: IngestPart[] = []

    const date1904 = workbook.properties.date1904 === true

    workbook.worksheets.forEach((worksheet, sheetIndex) => {
      const dimensions = worksheet.dimensions
      const sourceRange = {
        address: dimensions.shortRange,
        rowStart: dimensions.top,
        rowEnd: dimensions.bottom,
        columnStart: dimensions.left,
        columnEnd: dimensions.right,
      }
      const merges = xlsxMergeMap(worksheet)
      const rows: string[][] = []
      const sourceRows: IngestSpreadsheetRow[] = []
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const rowSourceRange = {
          address: `${row.getCell(sourceRange.columnStart).address}:${row.getCell(sourceRange.columnEnd).address}`,
          rowStart: row.number,
          rowEnd: row.number,
          columnStart: sourceRange.columnStart,
          columnEnd: sourceRange.columnEnd,
        }
        const cells = Array.from({ length: sourceRange.columnEnd - sourceRange.columnStart + 1 }, (_, index) => {
          const column = sourceRange.columnStart + index
          const cell = row.getCell(column)
          const merge = merges.get(cell.address)
          const isMergeFollower = merge !== undefined && merge.master !== cell.address
          return {
            row: row.number,
            column,
            address: cell.address,
            value: isMergeFollower ? '' : formatCell(cell, date1904, worksheet.name, ctx.warn),
            ...(!isMergeFollower && cell.formula ? { formula: cell.formula } : {}),
            ...(merge ? { merge } : {}),
          }
        })
        rows.push(cells.map((cell) => cell.value))
        sourceRows.push({
          row: row.number,
          address: rowSourceRange.address,
          sourceRange: rowSourceRange,
          cells,
        })
      })

      if (rows.length === 0) return

      const table: IngestTablePart = {
        id: `xlsx:${worksheet.name}:table:1`,
        kind: 'table',
        sheetName: worksheet.name,
        rowStart: sourceRows[0].row,
        rowEnd: sourceRows[sourceRows.length - 1].row,
        rows,
        sourceRange,
        sourceRows,
        columns: rows[0],
        content: renderRows(rows),
      }

      parts.push({
        id: `xlsx:sheet:${sheetIndex + 1}`,
        kind: 'sheet',
        sheetName: worksheet.name,
        index: sheetIndex,
        sourceRange,
        tables: [table],
        content: `[Sheet: ${worksheet.name}]\n${deriveContent([table])}`,
      })
      parts.push(table)
    })

    return { parts }
  },
}

export const builtInParsers: IngestParser[] = [
  plainTextParser,
  markdownParser,
  htmlParser,
  pdfParser,
  imageParser,
  audioParser,
  videoParser,
  csvParser,
  jsonParser,
  docxParser,
  xlsxParser,
]

function parseHtmlParts(html: string, idPrefix: string): ParseResult {
  const $ = loadHtml(html)
  const title = $('title').first().text().trim() || undefined
  const parts: IngestPart[] = []
  const headingPath: string[] = []
  let counter = 0

  $('body')
    .find('h1,h2,h3,h4,h5,h6,p,li,pre,code,table')
    .each((_, element) => {
      const tag = element.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const depth = Number(tag.slice(1))
        const heading = $(element).text().replace(/\s+/g, ' ').trim()
        if (!heading) return
        headingPath.splice(depth - 1)
        headingPath[depth - 1] = heading
        parts.push({
          id: `${idPrefix}:text:${++counter}`,
          kind: 'text',
          role: 'heading',
          headingPath: headingPath.filter(Boolean),
          content: heading,
        })
        return
      }

      if (tag === 'table') {
        const rows: string[][] = []
        $(element)
          .find('tr')
          .each((__, row) => {
            const cells: string[] = []
            $(row)
              .find('th,td')
              .each((___, cell) => {
                cells.push($(cell).text().replace(/\s+/g, ' ').trim())
              })
            if (cells.length) rows.push(cells)
          })
        if (rows.length) {
          parts.push({
            id: `${idPrefix}:table:${++counter}`,
            kind: 'table',
            rows,
            columns: rows[0],
            content: renderRows(rows),
            metadata: { headingPath: headingPath.filter(Boolean) },
          })
        }
        return
      }

      const content = $(element).text().replace(/\s+/g, ' ').trim()
      if (content) {
        parts.push({
          id: `${idPrefix}:text:${++counter}`,
          kind: 'text',
          role: tag === 'li' ? 'list' : tag === 'pre' || tag === 'code' ? 'code' : 'paragraph',
          headingPath: headingPath.filter(Boolean),
          content,
        })
      }
    })

  if (parts.length === 0) {
    const text = $.root().text().replace(/\s+/g, ' ').trim()
    if (text) {
      parts.push({ id: `${idPrefix}:text:1`, kind: 'text', role: 'paragraph', content: text })
    }
  }

  return { parts, ...(title ? { title } : {}) }
}

function collectJsonParts(value: unknown, path: string, parts: IngestPart[]): void {
  const valueType = jsonValueType(value)
  parts.push({
    id: `json:${parts.length + 1}`,
    kind: 'json',
    path,
    valueType,
    content: `${path}: ${formatJsonValue(value)}`,
  })

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonParts(item, `${path}[${index}]`, parts))
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectJsonParts(nested, `${path}.${key}`, parts)
    }
  }
}

function jsonValueType(value: unknown): 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'object'
  }
}

function formatJsonValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function formatCell(cell: ExcelJS.Cell, date1904: boolean, sheetName: string, warn: (warning: IngestWarning) => void): string {
  const value = cell.value
  const displayValue = cell.formula ? cell.result : value
  const fallback = projectXlsxDisplayValue(displayValue, { sheetName, address: cell.address, warn })
  if (!cell.numFmt || displayValue === null || displayValue === undefined) return fallback
  if (typeof displayValue !== 'number' && !(displayValue instanceof Date)) return fallback

  try {
    return SSF.format(cell.numFmt, displayValue, { date1904 })
  } catch (error) {
    warn({
      code: 'parser_warning',
      message: `Could not apply XLSX number format for cell ${cell.address}; emitted raw value.`,
      metadata: {
        sheetName,
        address: cell.address,
        numFmt: cell.numFmt,
        reason: error instanceof Error ? error.message : String(error),
      },
    })
    return fallback
  }
}

export function projectXlsxDisplayValue(
  value: unknown,
  ctx: { sheetName: string; address: string; warn: (warning: IngestWarning) => void },
): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'object':
      return projectXlsxStructuredDisplayValue(value as Record<string, unknown>, ctx)
    default:
      return ''
  }
}

function projectXlsxStructuredDisplayValue(
  value: Record<string, unknown>,
  ctx: { sheetName: string; address: string; warn: (warning: IngestWarning) => void },
): string {
  if ('richText' in value) {
    if (!Array.isArray(value.richText)) return rejectXlsxStructuredValue(ctx, 'richText')
    const runs = value.richText
    if (!runs.every((run) => run && typeof run === 'object' && typeof (run as { text?: unknown }).text === 'string')) {
      return rejectXlsxStructuredValue(ctx, 'richText')
    }
    return runs.map((run) => (run as { text: string }).text).join('')
  }

  if ('hyperlink' in value || 'text' in value) {
    if (typeof value.hyperlink === 'string' && typeof value.text === 'string') return value.text
    return rejectXlsxStructuredValue(ctx, 'hyperlink' in value ? 'hyperlink' : 'textOnly')
  }

  if ('formula' in value) {
    if (typeof value.formula !== 'string') return rejectXlsxStructuredValue(ctx, 'formula')
    return 'result' in value ? projectXlsxDisplayValue(value.result, ctx) : ''
  }

  if ('sharedFormula' in value) {
    if (typeof value.sharedFormula !== 'string') return rejectXlsxStructuredValue(ctx, 'sharedFormula')
    return 'result' in value ? projectXlsxDisplayValue(value.result, ctx) : ''
  }

  if ('error' in value) {
    if (typeof value.error === 'string') return value.error
    return rejectXlsxStructuredValue(ctx, 'error')
  }

  if ('result' in value) return rejectXlsxStructuredValue(ctx, 'resultOnly')

  return rejectXlsxStructuredValue(ctx, 'unknown')
}

function rejectXlsxStructuredValue(
  ctx: { sheetName: string; address: string; warn: (warning: IngestWarning) => void },
  valueShape: 'richText' | 'hyperlink' | 'formula' | 'sharedFormula' | 'error' | 'textOnly' | 'resultOnly' | 'unknown',
): string {
  ctx.warn({
    code: 'parser_warning',
    message: `Could not project XLSX structured value for cell ${ctx.address}; emitted empty value.`,
    metadata: { sheetName: ctx.sheetName, address: ctx.address, valueShape },
  })
  return ''
}

function xlsxMergeMap(worksheet: ExcelJS.Worksheet): Map<string, IngestSpreadsheetMerge> {
  const merges = new Map<string, IngestSpreadsheetMerge>()
  const mergeRanges = Array.isArray(worksheet.model.merges) ? worksheet.model.merges : []
  for (const mergeAddress of mergeRanges) {
    if (typeof mergeAddress !== 'string') continue
    const sourceRange = parseXlsxRange(mergeAddress)
    if (!sourceRange) continue
    const master = xlsxAddress(sourceRange.rowStart, sourceRange.columnStart)
    const merge: IngestSpreadsheetMerge = { master, sourceRange }
    for (let row = sourceRange.rowStart; row <= sourceRange.rowEnd; row += 1) {
      for (let column = sourceRange.columnStart; column <= sourceRange.columnEnd; column += 1) {
        merges.set(xlsxAddress(row, column), merge)
      }
    }
  }
  return merges
}

function parseXlsxRange(address: string): IngestSpreadsheetRange | undefined {
  const [start, end = start] = address.split(':')
  const startCell = parseXlsxAddress(start)
  const endCell = parseXlsxAddress(end)
  if (!startCell || !endCell) return undefined
  const rowStart = Math.min(startCell.row, endCell.row)
  const rowEnd = Math.max(startCell.row, endCell.row)
  const columnStart = Math.min(startCell.column, endCell.column)
  const columnEnd = Math.max(startCell.column, endCell.column)
  return {
    address,
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
  }
}

function parseXlsxAddress(address: string | undefined): { row: number; column: number } | undefined {
  const match = /^([A-Z]+)(\d+)$/i.exec(address ?? '')
  if (!match) return undefined
  return { column: xlsxColumnNumber(match[1].toUpperCase()), row: Number(match[2]) }
}

function xlsxColumnNumber(column: string): number {
  let value = 0
  for (let index = 0; index < column.length; index += 1) {
    value = value * 26 + column.charCodeAt(index) - 64
  }
  return value
}

function xlsxAddress(row: number, column: number): string {
  let remaining = column
  let letters = ''
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26
    letters = String.fromCharCode(65 + modulo) + letters
    remaining = Math.floor((remaining - modulo) / 26)
  }
  return `${letters}${row}`
}

function renderRows(rows: string[][]): string {
  return rows.map((row) => row.join(' | ')).join('\n')
}

function markdownRole(type: string): IngestTextPart['role'] {
  switch (type) {
    case 'list':
    case 'listItem':
      return 'list'
    case 'code':
      return 'code'
    default:
      return 'paragraph'
  }
}

function isTextLike(format: IngestFormat): boolean {
  return (
    format === 'txt' ||
    format === 'md' ||
    format === 'html' ||
    format === 'csv' ||
    format === 'json' ||
    format === 'unknown'
  )
}

function toParseError(error: unknown, parser: string): IngestError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as IngestError
  }
  if (error instanceof Error) {
    return {
      code: 'parse_failed',
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      parser,
    }
  }
  return {
    code: 'parse_failed',
    message: String(error),
    parser,
  }
}

interface MarkdownNode {
  type: string
  depth?: number
  children?: MarkdownNode[]
}
