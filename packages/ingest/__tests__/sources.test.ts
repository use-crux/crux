import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexer, resetHooks, retriever } from '@use-crux/core'
import { embedding } from '@use-crux/core/embedding'
import { inMemoryRecordStore, inMemoryVectorStore } from '@use-crux/core/storage'
import {
  subscribeObservability,
  type CruxGraphRecord,
  type CruxSpanEndRecord,
  type CruxSpanStartRecord,
} from '@use-crux/core/observability'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileSource, filesSource, textSource, urlSource, urlsSource } from '../src'
import type { Asset } from '@use-crux/core'
import type { IngestMediaOperations, IngestParser, ParserOptions } from '../src'

const removedOcrOptions = {
  // @ts-expect-error pre-v1 OCR hooks were removed in favor of media operations.
  ocr: {},
} satisfies ParserOptions
void removedOcrOptions

if (false) {
  const asset = {} as Asset
  // @ts-expect-error Asset sources require an explicit sourceId.
  fileSource(asset, { namespace: 'kb' })
}

const tempDirs: string[] = []

afterEach(async () => {
  resetHooks()
  while (tempDirs.length > 0) {
    const path = tempDirs.pop()!
    await rm(path, { recursive: true, force: true })
  }
})

describe('@use-crux/ingest structured sources', () => {
  it('derives one ordered text part per audio segment with seconds locations', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'meeting.wav')
    await writeFile(path, new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))
    const transcribe = vi.fn(async () => ({
      text: 'Hello world',
      segments: [{ text: 'Hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }],
      language: 'en', durationInSeconds: 1, warnings: ['native warning'],
      metadata: { secret: 'provider-secret' }, raw: { secret: 'raw-secret' },
    }))

    const [document] = await collect(fileSource(path, { namespace: 'kb', media: { transcribe } }).documents())

    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(document.parts).toMatchObject([
      { content: 'Hello', sourceLocation: { type: 'time', unit: 'seconds', start: 0, end: 0.5 } },
      { content: 'world', sourceLocation: { type: 'time', unit: 'seconds', start: 0.5, end: 1 } },
    ])
    expect(document.source).toEqual({ path, mediaType: 'audio/wav' })
    expect(document.metadata).toMatchObject({ format: 'audio', parser: 'audio', language: 'en', durationInSeconds: 1 })
    expect(document.warnings).toEqual([{ code: 'parser_warning', message: 'native warning' }])
    expect(JSON.stringify(document)).not.toMatch(/raw-secret|provider-secret|82,73,70,70/)
  })

  it('uses one full transcript part without timing and propagates only StoredAsset refs', async () => {
    const transcribe = vi.fn(async () => ({
      text: 'Full transcript', segments: [], warnings: ['timing unavailable'], raw: null,
    }))
    const stored = {
      type: 'data' as const,
      data: new Uint8Array([0x49, 0x44, 0x33]),
      mediaType: 'audio/mpeg',
      filename: 'meeting.mp3',
      ref: { uri: 'asset://meeting' },
    }
    const [document] = await collect(fileSource(stored, {
      namespace: 'kb', sourceId: 'meeting', media: { transcribe },
    }).documents())

    expect(document.parts).toMatchObject([{ id: 'audio:text:1', content: 'Full transcript' }])
    expect(document.source).toEqual({ assetRef: { uri: 'asset://meeting' }, mediaType: 'audio/mpeg' })
    expect(document.metadata?.assetRef).toEqual({ uri: 'asset://meeting' })
    expect(JSON.stringify(document)).not.toContain('73,68,51')
  })

  it('does not retain signed audio URLs after fetching', async () => {
    const transcribe = vi.fn(async () => ({ text: 'Remote transcript', segments: [], raw: null }))
    const [document] = await collect(urlSource('https://example.com/meeting.wav?signature=secret', {
      namespace: 'kb', media: { transcribe },
      fetch: async () => new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), {
        headers: { 'content-type': 'audio/wav' },
      }),
    }).documents())

    expect(document.sourceId).toBe('https://example.com/meeting.wav')
    expect(document.source).toEqual({ url: 'https://example.com/meeting.wav', mediaType: 'audio/wav' })
    expect(document.metadata?.sourceUrl).toBe('https://example.com/meeting.wav')
    expect(JSON.stringify(document)).not.toContain('secret')
  })

  it('fails precisely for missing transcription, invalid segments, and operation errors', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'meeting.wav')
    await writeFile(path, new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))
    await expect(collect(fileSource(path, { namespace: 'kb' }).documents())).rejects.toThrow(/media\.transcribe/)

    const invalid = vi.fn(async () => ({
      text: 'Hello', segments: [{ text: 'Hello', start: 2, end: 1 }], raw: null,
    }))
    await expect(collect(fileSource(path, { namespace: 'kb', media: { transcribe: invalid } }).documents())).rejects.toThrow(/invalid seconds segments/)

    const abort = Object.assign(new Error('operation aborted'), { name: 'AbortError' })
    const failing = vi.fn(async () => Promise.reject(abort))
    const [result] = await collect(fileSource(path, { namespace: 'kb', media: { transcribe: failing } }).load())
    expect(result).toMatchObject({ ok: false, error: { message: 'operation aborted', parser: 'audio' } })
  })

  it('derives ordinary text from image files through one bound media operation', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'chart.png')
    await writeFile(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    const generate = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['generate']>>[0]) => ({ text: 'Revenue rose from 10 to 20.' }))

    const media = { generate } satisfies IngestMediaOperations
    const docs = await collect(fileSource(path, {
      namespace: 'kb',
      media,
    }).documents())

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0].messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text' }, { type: 'image', mediaType: 'image/png' }],
    })
    expect(docs[0].parts).toEqual([{ id: 'image:text:1', kind: 'text', role: 'paragraph', content: 'Revenue rose from 10 to 20.' }])
  })

  it('accepts explicitly identified Assets without retaining their bytes', async () => {
    const generate = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['generate']>>[0]) => ({ text: 'A small chart.' }))
    const asset = {
      type: 'data' as const,
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mediaType: 'image/png',
      filename: 'chart.png',
    }
    const [document] = await collect(fileSource(asset, {
      namespace: 'kb', sourceId: 'asset:chart', media: { generate },
    }).documents())

    expect(document.sourceId).toBe('asset:chart')
    expect(document.metadata).toMatchObject({ mediaType: 'image/png', format: 'image', parser: 'image' })
    expect(JSON.stringify(document)).not.toContain('137,80,78,71')
  })

  it('detects URL images by response MIME and fails precisely without media.generate', async () => {
    const source = urlSource('https://example.com/chart', {
      namespace: 'kb',
      fetch: async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        headers: { 'content-type': 'image/png' },
      }),
    })

    await expect(collect(source.documents())).rejects.toThrow(/chart.*image\/png.*media\.generate/i)
  })

  it('uses media generation only for PDF pages without meaningful native text', async () => {
    const dir = await makeTempDir()
    const textPath = join(dir, 'text.pdf')
    const visualPath = join(dir, 'visual.pdf')
    await writeFile(textPath, makePdf('Native text'))
    await writeFile(visualPath, makePdf(''))
    const generate = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['generate']>>[0]) => ({ text: 'Diagram page.' }))

    await collect(fileSource(textPath, { namespace: 'kb', media: { generate } }).documents())
    const visual = await collect(fileSource(visualPath, { namespace: 'kb', media: { generate } }).documents())

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0].messages[0].content).toMatchObject([
      { type: 'text', text: expect.stringContaining('page 1') },
      { type: 'file', mediaType: 'application/pdf' },
    ])
    expect(visual[0].content).toContain('Diagram page.')
  })

  it('retrieves visual PDF pages and audio segments with structured AssetRef attribution', async () => {
    const pdf = {
      type: 'data' as const, data: new Uint8Array(makePdf('')), mediaType: 'application/pdf', filename: 'diagram.pdf',
      ref: { uri: 'asset://diagram' },
    }
    const audio = {
      type: 'data' as const, data: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
      mediaType: 'audio/wav', filename: 'meeting.wav', ref: { uri: 'asset://meeting' },
    }
    const [pdfDocument] = await collect(fileSource(pdf, {
      namespace: 'kb', sourceId: 'visual-pdf', media: { generate: async () => ({ text: 'Architecture diagram' }) },
    }).documents())
    const [audioDocument] = await collect(fileSource(audio, {
      namespace: 'kb', sourceId: 'meeting-audio', media: { transcribe: async () => ({
        text: 'Launch discussion', segments: [{ text: 'Launch discussion', start: 1, end: 2.5 }], raw: null,
      }) },
    }).documents())
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const dense = embedding({
      kind: 'dense', name: 'media-attribution', dimensions: 2, maxInputTokens: 100, batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => text.toLowerCase().includes('diagram') ? [1, 0] : [0, 1]),
    })
    await indexer({ id: 'media', namespace: 'kb', records, vectors, dense })
      .indexDocuments([pdfDocument, audioDocument])
    const search = retriever({ id: 'media', namespace: 'kb', records, vectors, dense })

    await expect(search.retrieve('diagram', { limit: 1 })).resolves.toMatchObject([{
      source: {
        id: 'visual-pdf', assetRef: { uri: 'asset://diagram' }, mediaType: 'application/pdf',
        location: { type: 'page', pageNumber: 1 },
      },
    }])
    await expect(search.retrieve('launch', { limit: 1 })).resolves.toMatchObject([{
      source: {
        id: 'meeting-audio', assetRef: { uri: 'asset://meeting' }, mediaType: 'audio/wav',
        location: { type: 'time', unit: 'seconds', start: 1, end: 2.5 },
      },
    }])
  })

  it('textSource load yields result objects and documents yields plain documents', async () => {
    const source = textSource({
      namespace: 'kb',
      sourceId: 'manual:1',
      content: 'hello',
    })

    const results = await collect(source.load())
    const docs = await collect(source.documents())

    expect(results[0]).toMatchObject({
      ok: true,
      document: {
        namespace: 'kb',
        sourceId: 'manual:1',
        content: 'hello',
        parts: [{ kind: 'text', content: 'hello' }],
      },
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].content).toBe('hello')
  })

  it('textSource reports invalid documents through load and throws through documents', async () => {
    const source = textSource({ namespace: '', sourceId: 'bad', content: 'x' })

    const results = await collect(source.load())

    expect(results[0]).toMatchObject({
      ok: false,
      namespace: '',
      sourceId: 'bad',
      error: { code: 'empty_namespace' },
    })
    await expect(collect(source.documents())).rejects.toThrow('namespace')
  })

  it('fileSource loads plain text files as text parts', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'note.txt')
    await writeFile(path, 'hello world', 'utf8')

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0]).toMatchObject({
      namespace: 'kb',
      sourceId: path,
      content: 'hello world',
      title: 'note.txt',
      metadata: {
        sourcePath: path,
        format: 'txt',
        parser: 'text',
      },
      parts: [{ kind: 'text', role: 'paragraph', content: 'hello world' }],
    })
  })

  it('fileSource extracts structured text and table parts from html files', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'page.html')
    await writeFile(
      path,
      '<html><head><title>Pricing</title></head><body><h1>Pricing</h1><p>Starter plan</p><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$20</td></tr></table></body></html>',
      'utf8',
    )

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0].title).toBe('Pricing')
    expect(docs[0].parts.some((part) => part.kind === 'text' && part.role === 'heading')).toBe(true)
    expect(docs[0].parts.some((part) => part.kind === 'table')).toBe(true)
    expect(docs[0].content).toContain('Pricing')
    expect(docs[0].content).toContain('| Plan | Price |')
  })

  it('fileSource extracts markdown headings and GFM tables', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'guide.md')
    await writeFile(path, '# Roadmap\n\nIntro\n\n| Area | Status |\n| --- | --- |\n| API | Ready |', 'utf8')

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0].parts.some((part) => part.kind === 'text' && part.role === 'heading')).toBe(true)
    expect(docs[0].parts.some((part) => part.kind === 'table')).toBe(true)
    expect(docs[0].content).toContain('Roadmap')
    expect(docs[0].content).toContain('| Area | Status |')
  })

  it('filesSource loads explicit file lists in order', async () => {
    const dir = await makeTempDir()
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.md')
    await writeFile(a, 'A', 'utf8')
    await writeFile(b, '# B', 'utf8')

    const docs = await collect(filesSource([a, b], { namespace: 'kb' }).documents())

    expect(docs.map((document) => document.sourceId)).toEqual([a, b])
  })

  it('filesSource walks directories recursively by default', async () => {
    const dir = await makeTempDir()
    const nested = join(dir, 'nested')
    await mkdir(nested)
    await writeFile(join(dir, 'root.txt'), 'root', 'utf8')
    await writeFile(join(nested, 'child.txt'), 'child', 'utf8')

    const docs = await collect(filesSource({ directory: dir }, { namespace: 'kb' }).documents())

    expect(docs).toHaveLength(2)
    expect(docs.some((document) => document.content === 'root')).toBe(true)
    expect(docs.some((document) => document.content === 'child')).toBe(true)
  })

  it('filesSource supports glob patterns', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'one.txt'), 'one', 'utf8')
    await writeFile(join(dir, 'two.md'), 'two', 'utf8')
    await writeFile(join(dir, 'three.html'), '<p>three</p>', 'utf8')

    const docs = await collect(filesSource({ cwd: dir, glob: '**/*.txt' }, { namespace: 'kb' }).documents())

    expect(docs).toHaveLength(1)
    expect(docs[0].content).toBe('one')
  })

  it('urlSource loads html via fetch and extracts structured parts', async () => {
    const docs = await collect(
      urlSource('https://example.com/pricing', {
        namespace: 'kb',
        fetch: async () =>
          new Response('<html><head><title>Pricing</title></head><body><p>Starter plan</p></body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      }).documents(),
    )

    expect(docs[0]).toMatchObject({
      namespace: 'kb',
      sourceId: 'https://example.com/pricing',
      title: 'Pricing',
      metadata: {
        sourceUrl: 'https://example.com/pricing',
        format: 'html',
        parser: 'html',
      },
    })
    expect(docs[0].parts.some((part) => part.kind === 'text')).toBe(true)
    expect(docs[0].content).toContain('Starter plan')
  })

  it('urlsSource loads a list of urls sequentially', async () => {
    const docs = await collect(
      urlsSource(['https://a.test', 'https://b.test'], {
        namespace: 'kb',
        fetch: async (input) =>
          new Response(String(input), {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
      }).documents(),
    )

    expect(docs.map((document) => document.content)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('fileSource extracts page parts from pdf files', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'doc.pdf')
    await writeFile(path, makePdf('Hello PDF'))

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0]).toMatchObject({
      namespace: 'kb',
      sourceId: path,
      title: 'doc.pdf',
      metadata: {
        sourcePath: path,
        format: 'pdf',
        parser: 'pdf',
      },
    })
    expect(docs[0].parts[0]).toMatchObject({ kind: 'page', pageNumber: 1 })
    expect(docs[0].content).toContain('[Page 1]')
    expect(docs[0].content).toContain('Hello PDF')
  })

  it('urlSource extracts page parts from pdf responses', async () => {
    const docs = await collect(
      urlSource('https://example.com/doc.pdf', {
        namespace: 'kb',
        fetch: async () =>
          new Response(new Uint8Array(makePdf('Roadmap PDF')), {
            status: 200,
            headers: { 'content-type': 'application/pdf' },
          }),
      }).documents(),
    )

    expect(docs[0].parts[0]).toMatchObject({ kind: 'page', pageNumber: 1 })
    expect(docs[0].content).toContain('Roadmap PDF')
  })

  it('fileSource extracts csv files as table parts', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'pricing.csv')
    await writeFile(path, 'Plan,Price\nPro,20', 'utf8')

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0].parts[0]).toMatchObject({
      kind: 'table',
      rows: [
        ['Plan', 'Price'],
        ['Pro', '20'],
      ],
      columns: ['Plan', 'Price'],
    })
  })

  it('fileSource extracts json files as json parts', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'data.json')
    await writeFile(path, JSON.stringify({ plan: { name: 'Pro', price: 20 } }), 'utf8')

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0].parts.some((part) => part.kind === 'json' && part.path === '$.plan.name')).toBe(true)
    expect(docs[0].content).toContain('$.plan.name: Pro')
  })

  it('fileSource reports invalid json as a source-level failure', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'bad.json')
    await writeFile(path, '{not-json', 'utf8')

    const results = await collect(fileSource(path, { namespace: 'kb' }).load())

    expect(results[0]).toMatchObject({
      ok: false,
      sourceId: path,
      error: { code: 'parse_failed', parser: 'json' },
    })
  })

  it('fileSource extracts xlsx sheets and tables', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'pricing.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Pricing')
    sheet.addRow(['Plan', 'Price'])
    sheet.addRow(['Pro', 20])
    await workbook.xlsx.writeFile(path)

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0].parts.some((part) => part.kind === 'sheet' && part.sheetName === 'Pricing')).toBe(true)
    expect(docs[0].parts.some((part) => part.kind === 'table' && part.sheetName === 'Pricing')).toBe(true)
    expect(docs[0].content).toContain('[Sheet: Pricing]')
    expect(docs[0].content).toContain('Plan | Price')
  })

  it('fileSource extracts docx text and table content', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'guide.docx')
    await writeFile(path, await makeDocx())

    const docs = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(docs[0]).toMatchObject({
      namespace: 'kb',
      sourceId: path,
      metadata: {
        sourcePath: path,
        format: 'docx',
        parser: 'docx',
      },
    })
    expect(docs[0].content).toContain('Release Notes')
    expect(docs[0].content).toContain('Ship structured ingestion')
    expect(docs[0].content).toContain('Plan | Status')
  })

  it('custom parsers override built-ins', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'note.txt')
    await writeFile(path, 'original', 'utf8')
    const parser: IngestParser = {
      name: 'custom-text',
      formats: ['txt'],
      parse: () => ({
        parts: [{ id: 'custom:1', kind: 'text', role: 'paragraph', content: 'custom' }],
      }),
    }

    const docs = await collect(fileSource(path, { namespace: 'kb', parsers: [parser] }).documents())

    expect(docs[0].content).toBe('custom')
    expect(docs[0].metadata?.parser).toBe('custom-text')
  })

  it('emits parser instrumentation for successful and failed parse attempts', async () => {
    const dir = await makeTempDir()
    const okPath = join(dir, 'note.txt')
    const badPath = join(dir, 'bad.json')
    await writeFile(okPath, 'hello', 'utf8')
    await writeFile(badPath, '{not-json', 'utf8')
    const records: CruxGraphRecord[] = []
    const unsubscribe = subscribeObservability((record) => records.push(record))

    try {
      await collect(fileSource(okPath, { namespace: 'kb' }).load())
      await collect(fileSource(badPath, { namespace: 'kb' }).load())
    } finally {
      unsubscribe()
    }

    const starts = records.filter(isIngestParseStart)
    const ends = records.filter(isIngestParseEnd)

    expect(starts).toMatchObject([
      { attributes: { parser: 'text', sourceId: okPath, byteLength: 5 } },
      { attributes: { parser: 'json', sourceId: badPath, byteLength: 9 } },
    ])
    expect(ends[0]).toMatchObject({
      status: 'ok',
      attributes: { parser: 'text', sourceId: okPath, partCount: 1, warningCount: 0 },
    })
    expect(ends[1]).toMatchObject({
      status: 'error',
      attributes: { parser: 'json', sourceId: badPath, partCount: 0, warningCount: 0 },
    })
    expect(ends[1].error?.message).toContain('JSON')
  })
})

function isIngestParseStart(record: CruxGraphRecord): record is CruxSpanStartRecord {
  return record.type === 'span:start' && record.primitive === 'ingest.parse'
}

function isIngestParseEnd(record: CruxGraphRecord): record is CruxSpanEndRecord {
  return record.type === 'span:end' && record.attributes?.parser !== undefined
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) {
    result.push(item)
  }
  return result
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'crux-ingest-'))
  tempDirs.push(dir)
  return dir
}

function makePdf(text: string): Buffer {
  const stream = text ? `BT\n/F1 24 Tf\n72 100 Td\n(${escapePdfText(text)}) Tj\nET` : 'q\nQ'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(pdf, 'utf8')
}

async function makeDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Release Notes', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Ship structured ingestion'),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Plan')] }),
                  new TableCell({ children: [new Paragraph('Status')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Parser')] }),
                  new TableCell({ children: [new Paragraph('Ready')] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  })
  return Buffer.from(await Packer.toBuffer(document))
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
