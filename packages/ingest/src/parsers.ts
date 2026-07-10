import { parse as parseCsv } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import { load as loadHtml } from 'cheerio'
import mammoth from 'mammoth'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import { deriveContent } from './document'
import { normalizeDocument } from './document'
import { openIngestParseObservation } from './observability'
import { parsePdf } from './pdf'
import type {
  IngestDocument,
  IngestError,
  IngestFormat,
  IngestParser,
  IngestPart,
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
  format: IngestFormat
  title?: string
  metadata?: Record<string, unknown>
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
      const parsed = await parser.parse(
        {
          bytes: input.bytes,
          ...(text !== undefined ? { text } : {}),
          format: input.format,
          sourceId: input.sourceId,
          namespace: input.namespace,
          title: input.title,
          metadata: input.metadata,
        },
        {
          ocr: input.options?.ocr,
          warn: (warning) => warnings.push(warning),
        },
      )
      warnings.push(...(parsed.warnings ?? []))

      const document = normalizeDocument({
        namespace: input.namespace,
        sourceId: input.sourceId,
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
    return parsePdf(input.bytes, ctx)
  },
}

export const csvParser: IngestParser = {
  name: 'csv',
  formats: ['csv'],
  parse(input) {
    const text = input.text ?? new TextDecoder('utf-8').decode(input.bytes)
    const records = parseCsv(text, { relax_column_count: true, skip_empty_lines: true }) as string[][]
    const rows = records.map((row) => row.map((cell) => String(cell ?? '')))
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
  formats: ['xlsx'],
  async parse(input) {
    const workbook = new ExcelJS.Workbook()
    const workbookBytes = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    )
    await workbook.xlsx.load(workbookBytes as Parameters<typeof workbook.xlsx.load>[0])
    const parts: IngestPart[] = []

    workbook.worksheets.forEach((worksheet, sheetIndex) => {
      const rows: string[][] = []
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values as unknown[]
        rows.push(values.slice(1).map((value) => formatCell(value)))
      })

      if (rows.length === 0) return

      const table: IngestTablePart = {
        id: `xlsx:${worksheet.name}:table:1`,
        kind: 'table',
        sheetName: worksheet.name,
        rowStart: 1,
        rowEnd: rows.length,
        rows,
        columns: rows[0],
        content: renderRows(rows),
      }

      parts.push({
        id: `xlsx:sheet:${sheetIndex + 1}`,
        kind: 'sheet',
        sheetName: worksheet.name,
        index: sheetIndex,
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

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text)
  if (typeof value === 'object' && 'result' in value) return String((value as { result: unknown }).result)
  return String(value)
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
