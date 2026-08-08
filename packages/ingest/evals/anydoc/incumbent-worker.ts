import { Socket } from 'node:net'
import mammoth from 'mammoth'
import { parse as parseCsv } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import { extractPagesMarkdown } from '@firecrawl/pdf-inspector'
import { parseCsvDocument } from '../../src/csv'
import { adaptMammothDocxResult } from '../../src/docx'
import { parsePdfDocument } from '../../src/pdf'
import { parseXlsxDocument } from '../../src/xlsx'
import { extractCsvNativeFacts } from './native-csv-facts'
import { extractExcelNativeFacts } from './native-xlsx-facts'
import { extractMammothNativeFacts } from './native-mammoth-facts'
import { extractPdfNativeFacts } from './native-pdf-facts'

const result = new Socket({ fd: 3, readable: true, writable: true })
const control = new Socket({ fd: 4, readable: true, writable: true })
const parser = process.argv[2]
const format = process.argv[3]
const chunks: Buffer[] = []

process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => void convert(Buffer.concat(chunks)))

async function convert(bytes: Buffer): Promise<void> {
  try {
    const observed = await observeNative(parser, bytes)
    const facts = extractRawFacts(parser, observed.raw, bytes)
    const core = await projectCore(parser, format, bytes, observed.value)
    send(success({ ...(observed.value as object), facts }, core, bytes.byteLength + byteLength(observed.value) + byteLength(core)))
  } catch (error) {
    send(success(
      { kind: 'incumbent-native-v1', parser, outcome: { kind: 'failure', error: 'invalid-result', diagnosis: message(error) } },
      { outcome: { kind: 'failure', error: 'invalid-result', diagnosis: message(error) } },
      bytes.byteLength,
    ))
  }
}

async function observeNative(owner: string | undefined, bytes: Buffer): Promise<{ readonly value: unknown; readonly raw: unknown }> {
  if (owner === 'mammoth') {
    const value = await mammoth.convertToHtml({ buffer: bytes })
    const observed = { kind: 'mammoth-native-v1', parser: owner, html: value.value, messages: value.messages }
    return { value: observed, raw: observed }
  }
  if (owner === 'csv-parse') {
    const observed = { kind: 'csv-parse-native-v1', parser: owner, rows: parseCsv(bytes.toString('utf8'), { relax_column_count: true, skip_empty_lines: true }) }
    return { value: observed, raw: observed.rows }
  }
  if (owner === 'exceljs') {
    const workbook = new ExcelJS.Workbook()
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    await workbook.xlsx.load(data as Parameters<typeof workbook.xlsx.load>[0])
    return { value: { kind: 'exceljs-native-v1', parser: owner, model: workbook.model }, raw: workbook }
  }
  if (owner === 'pdf-inspector') {
    const pages = await extractPagesMarkdown(bytes)
    return { value: { kind: 'pdf-inspector-native-v1', parser: owner, pages }, raw: pages }
  }
  throw new Error(`Unknown incumbent parser: ${owner ?? '<missing>'}`)
}

function extractRawFacts(owner: string | undefined, raw: any, bytes: Buffer) {
  if (owner === 'mammoth') return extractMammothNativeFacts(raw.html, raw.messages, bytes)
  if (owner === 'csv-parse') return extractCsvNativeFacts(raw, bytes)
  if (owner === 'exceljs') return extractExcelNativeFacts(raw, bytes)
  if (owner === 'pdf-inspector') return extractPdfNativeFacts(raw, bytes)
  throw new Error(`Unknown incumbent parser: ${owner ?? '<missing>'}`)
}

async function projectCore(owner: string | undefined, sourceFormat: string | undefined, bytes: Buffer, observed: any): Promise<unknown> {
  if (owner === 'mammoth') {
    return adaptMammothDocxResult({ bytes, html: observed.html, messages: observed.messages })
  }
  if (owner === 'csv-parse') {
    return parseCsvDocument({ bytes })
  }
  if (owner === 'exceljs') {
    return parseXlsxDocument({ bytes, format: sourceFormat === 'xlsx' ? 'xlsx' : 'xlsm' })
  }
  if (owner === 'pdf-inspector') {
    // The control intentionally calls the direct inspector first. The existing
    // adapter performs the same direct call for its Core projection.
    return parsePdfDocument({ bytes })
  }
  throw new Error(`Unknown incumbent parser: ${owner ?? '<missing>'}`)
}

function success(nativeValue: unknown, coreValue: unknown, expandedBytes: number) {
  return {
    kind: 'success',
    native: { value: nativeValue, diagnostics: [], assets: [] },
    core: { value: coreValue, diagnostics: [], assets: [] },
    expandedBytes,
    diagnostics: { count: 0, byteLength: 0 },
    assets: { count: 0, byteLength: 0 },
  }
}

function send(payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload))
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(body.byteLength)
  result.end(Buffer.concat([header, body]))
  control.once('data', (ack) => {
    if (ack.toString() === 'ACK\n') {
      control.end('ACKED\n', () => process.exit(0))
    }
  })
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
