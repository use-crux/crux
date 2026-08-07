import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexer, resetHooks, retriever } from '@use-crux/core'
import { embedding } from '@use-crux/core/embedding'
import { inMemoryRecordStore, inMemorySearchStore } from '@use-crux/core/storage'
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
import { projectXlsxDisplayValue } from '../src/parsers'
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
  vi.doUnmock('@firecrawl/pdf-inspector')
  vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs')
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
      segments: [{ text: 'Hello', startSecond: 0, endSecond: 0.5 }, { text: 'world', startSecond: 0.5, endSecond: 1 }], words: [],
      language: 'en', durationInSeconds: 1, warnings: ['native warning'],
      providerMetadata: { secret: 'provider-secret' }, raw: { secret: 'raw-secret' }, execution: { kind: 'native' as const, calls: 1 },
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
      text: 'Full transcript', segments: [], words: [], warnings: ['timing unavailable'], raw: null, execution: { kind: 'native' as const, calls: 1 },
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
    const transcribe = vi.fn(async () => ({ text: 'Remote transcript', segments: [], words: [], warnings: [], raw: null, execution: { kind: 'native' as const, calls: 1 } }))
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
      text: 'Hello', segments: [{ text: 'Hello', startSecond: 2, endSecond: 1 }], words: [], warnings: [], raw: null, execution: { kind: 'native' as const, calls: 1 },
    }))
    await expect(collect(fileSource(path, { namespace: 'kb', media: { transcribe: invalid } }).documents())).rejects.toThrow(/invalid seconds segments/)

    const abort = Object.assign(new Error('operation aborted'), { name: 'AbortError' })
    const failing = vi.fn(async () => Promise.reject(abort))
    const [result] = await collect(fileSource(path, { namespace: 'kb', media: { transcribe: failing } }).load())
    expect(result).toMatchObject({ ok: false, error: { message: 'operation aborted', parser: 'audio' } })
  })

  it('derives video visual and soundtrack evidence explicitly with time lineage', async () => {
    const asset = {
      type: 'data' as const,
      data: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      mediaType: 'video/mp4',
    }
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: 'A chart is shown.' }))
    const transcribe = vi.fn(async () => ({
      text: 'Revenue doubled.', segments: [{ text: 'Revenue doubled.', startSecond: 2, endSecond: 4 }], words: [], warnings: [], raw: null, execution: { kind: 'native' as const, calls: 1 },
    }))

    const [document] = await collect(fileSource(asset, {
      namespace: 'kb', sourceId: 'demo', media: { describe, transcribe },
    }).documents())

    expect(describe.mock.calls[0]?.[0].messages[0]).toMatchObject({
      content: [{ type: 'text' }, { type: 'video', mediaType: 'video/mp4' }],
    })
    expect(document.parts).toMatchObject([
      { id: 'video:visual:1', content: 'A chart is shown.' },
      { id: 'video:soundtrack:1', content: 'Revenue doubled.', sourceLocation: { type: 'time', start: 2, end: 4 } },
    ])
    expect(document.metadata).toMatchObject({ format: 'video', parser: 'video', derivationMode: 'visual-and-soundtrack' })
    expect(document.warnings).toEqual([{ code: 'parser_warning', message: 'Video derivation used visual and soundtrack evidence.' }])
  })

  it('derives ordinary text from image files through one bound media operation', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'chart.png')
    await writeFile(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: 'Revenue rose from 10 to 20.' }))

    const media = { describe } satisfies IngestMediaOperations
    const docs = await collect(fileSource(path, {
      namespace: 'kb',
      media,
    }).documents())

    expect(describe).toHaveBeenCalledTimes(1)
    expect(describe.mock.calls[0]?.[0].messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text' }, { type: 'image', mediaType: 'image/png' }],
    })
    expect(docs[0].parts).toEqual([{ id: 'image:text:1', kind: 'text', role: 'paragraph', content: 'Revenue rose from 10 to 20.' }])
  })

  it('accepts explicitly identified Assets without retaining their bytes', async () => {
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: 'A small chart.' }))
    const asset = {
      type: 'data' as const,
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mediaType: 'image/png',
      filename: 'chart.png',
    }
    const [document] = await collect(fileSource(asset, {
      namespace: 'kb', sourceId: 'asset:chart', media: { describe },
    }).documents())

    expect(document.sourceId).toBe('asset:chart')
    expect(document.metadata).toMatchObject({ mediaType: 'image/png', format: 'image', parser: 'image' })
    expect(JSON.stringify(document)).not.toContain('137,80,78,71')
  })

  it('detects URL images by response MIME and fails precisely without media.describe', async () => {
    const source = urlSource('https://example.com/chart', {
      namespace: 'kb',
      fetch: async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        headers: { 'content-type': 'image/png' },
      }),
    })

    await expect(collect(source.documents())).rejects.toThrow(/chart.*image\/png.*media\.describe/i)
  })

  it('uses media generation only for PDF pages without meaningful native text', async () => {
    const dir = await makeTempDir()
    const textPath = join(dir, 'text.pdf')
    const visualPath = join(dir, 'visual.pdf')
    await writeFile(textPath, makePdf('Native text'))
    await writeFile(visualPath, makePdf(''))
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: 'Diagram page.' }))

    await collect(fileSource(textPath, { namespace: 'kb', media: { describe } }).documents())
    const visual = await collect(fileSource(visualPath, { namespace: 'kb', media: { describe } }).documents())

    expect(describe).toHaveBeenCalledTimes(1)
    expect(describe.mock.calls[0]?.[0].messages[0].content).toMatchObject([
      { type: 'text', text: expect.stringContaining('page 1') },
      { type: 'file', mediaType: 'application/pdf' },
    ])
    expect(visual[0].parts).toMatchObject([
      { id: 'pdf:page:1:visual', kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: 'Diagram page.' },
    ])
    expect(visual[0].content).toContain('Diagram page.')
    expect(visual[0].warnings).toBeUndefined()
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
      namespace: 'kb', sourceId: 'visual-pdf', media: { describe: async () => ({ text: 'Architecture diagram' }) },
    }).documents())
    const [audioDocument] = await collect(fileSource(audio, {
      namespace: 'kb', sourceId: 'meeting-audio', media: { transcribe: async () => ({
        text: 'Launch discussion', segments: [{ text: 'Launch discussion', startSecond: 1, endSecond: 2.5 }], words: [], warnings: [], raw: null, execution: { kind: 'native' as const, calls: 1 },
      }) },
    }).documents())
    const records = inMemoryRecordStore()
    const searchStore = inMemorySearchStore()
    const dense = embedding({
      kind: 'dense', name: 'media-attribution', dimensions: 2, maxInputTokens: 100, batch: { maxSize: 8 },
      modalities: ['text', 'audio', 'document'],
      embed: async (inputs) => inputs.map((input) => {
        if (input.type === 'text') return input.text.toLowerCase().includes('diagram') ? [1, 0] : [0, 1]
        return input.type === 'document' ? [1, 0] : [0, 1]
      }),
    })
    await indexer({ id: 'media', namespace: 'kb', records, search: searchStore, dense })
      .indexDocuments([pdfDocument, audioDocument])
    const search = retriever({ id: 'media', namespace: 'kb', records, search: searchStore, dense })

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

  it('extracts real layout-aware native PDF pages and routes only unreliable pages to media', async () => {
    const fixture = join(import.meta.dirname, 'fixtures', 'layout-aware-mixed.pdf')
    const native = await import('@firecrawl/pdf-inspector')
    const expected = native.extractPagesMarkdown(await readFile(fixture))
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: 'Visual-only appendix.' }))

    const [document] = await collect(fileSource(fixture, { namespace: 'kb', media: { describe } }).documents())

    expect(expected.pages).toHaveLength(8)
    expect(expected.pages.filter((page) => page.needsOcr).map((page) => page.page)).toEqual([7])
    expect(describe).toHaveBeenCalledTimes(1)
    expect(describe.mock.calls[0]?.[0].messages[0].content).toMatchObject([
      { type: 'text', text: expect.stringContaining('page 8') },
      { type: 'file', mediaType: 'application/pdf' },
    ])
    expect(document.parts).toHaveLength(8)
    expect(document.title).toBe('Firecrawl Documentation - API Reference')
    expect(document.parts.map((part) => part.sourceLocation)).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ type: 'page', pageNumber: index + 1 })),
    )
    const first = document.parts[0]
    expect(first).toMatchObject({
      id: 'pdf:page:1',
      kind: 'page',
      pageNumber: 1,
      content: expected.pages[0]?.markdown.trim(),
    })
    if (first?.kind !== 'page') throw new Error('expected first PDF page')
    expect(first.blocks?.map((block) => block.id)).toEqual(
      first.blocks?.map((_, ordinal) => `pdf:page:1/block:${ordinal}`),
    )
    const allBlocks = document.parts.flatMap((part) => part.kind === 'page' ? (part.blocks ?? []) : [])
    expect(allBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', role: 'heading', content: '# Firecrawl API Documentation', headingPath: ['Firecrawl API Documentation'] }),
      expect.objectContaining({ kind: 'text', role: 'paragraph' }),
      expect.objectContaining({ kind: 'table', columns: expect.any(Array), rows: expect.any(Array) }),
    ]))
    expect(allBlocks.every((block) => block.content.trim().length > 0)).toBe(true)
    expect(allBlocks).toContainEqual(expect.objectContaining({
      kind: 'text',
      role: 'heading',
      content: '### app = Firecrawl(api_key="fc-YOUR-API-KEY")',
      headingPath: ['Async Crawl with Polling', 'app = Firecrawl(api_key="fc-YOUR-API-KEY")'],
    }))
    const table = allBlocks.find((block) => block.kind === 'table')
    expect(table).toMatchObject({ kind: 'table', columns: expect.any(Array), rows: expect.any(Array) })
    if (!table || table.kind !== 'table') throw new Error('expected a table block')
    expect(table.columns).toEqual(['Parameter', 'Type', 'Default', 'Description'])
    expect(table.rows[0]).toEqual(['url', 'string', 'required', 'The URL to scrape'])
    expect([...(table.columns ?? []), ...table.rows.flat()].every((cell) => typeof cell === 'string')).toBe(true)
    const exactBlocks = allBlocks.filter((block) => block.sourceRange !== undefined)
    expect(exactBlocks.length).toBeGreaterThan(0)
    for (const block of exactBlocks) {
      const page = document.parts.find((part) => part.kind === 'page' && block.id.startsWith(`${part.id}/block:`))
      if (!page || page.kind !== 'page' || !block.sourceRange) throw new Error('expected ranged block page')
      expect(block.sourceRange.end).toBeGreaterThan(block.sourceRange.start)
      expect(page.content.slice(block.sourceRange.start, block.sourceRange.end)).toBe(block.content)
    }
    for (const block of first.blocks ?? []) {
      if (block.sourceRange) {
        expect(first.content.slice(block.sourceRange.start, block.sourceRange.end)).toBe(block.content)
      }
    }
    expect(document.parts[7]).toMatchObject({
      id: 'pdf:page:8:visual', kind: 'page', pageNumber: 8, content: 'Visual-only appendix.',
    })
    expect((document.parts[7] as { blocks?: unknown }).blocks).toBeUndefined()
    expect(document.warnings).toBeUndefined()
  })

  it('exposes every text block role, compact decoded paths, and only provable ranges through fileSource', async () => {
    const path = join(import.meta.dirname, 'fixtures', 'native-block-roles.pdf')
    const native = await import('@firecrawl/pdf-inspector')
    const expected = native.extractPagesMarkdown(await readFile(path))
    const describe = vi.fn(async () => ({ text: 'Cover page.' }))

    const [document] = await collect(fileSource(path, { namespace: 'kb', media: { describe } }).documents())
    const page = document.parts[1]
    if (!page || page.kind !== 'page' || !page.blocks) throw new Error('expected blocked page')

    expect(expected.pages).toMatchObject([
      { page: 0, markdown: '', needsOcr: true },
      { page: 1, needsOcr: false },
    ])
    expect(describe).toHaveBeenCalledTimes(1)
    expect(page.content).toBe(expected.pages[1]?.markdown.trim())
    expect(page.blocks.map((block) => block.id)).toEqual(page.blocks.map((_, index) => `pdf:page:2/block:${index}`))
    expect(page.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', role: 'paragraph', content: 'Opening paragraph.', sourceRange: { start: 0, end: 18 } }),
      expect.objectContaining({ kind: 'text', role: 'heading', content: '# Deep *link*', headingPath: ['Deep link'], sourceRange: { start: 20, end: 33 } }),
      expect.objectContaining({ kind: 'text', role: 'list', content: 'first item\nsecond item', headingPath: ['Deep link'] }),
      expect.objectContaining({ kind: 'text', role: 'code', content: '```ts\n\n## const answer = 42\n\n```', headingPath: ['Deep link'], sourceRange: { start: 62, end: 94 } }),
      expect.objectContaining({ kind: 'text', role: 'other', content: '<aside>Retained other</aside>', headingPath: ['Deep link'], sourceRange: { start: 96, end: 125 } }),
    ]))
    expect(page.blocks).toHaveLength(5)
    expect(page.blocks.every((block) => block.content.length > 0)).toBe(true)
    const list = page.blocks.find((block) => block.kind === 'text' && block.role === 'list')
    expect(list?.sourceRange).toBeUndefined()
    const exact = page.blocks.filter((block) => block.sourceRange !== undefined)
    expect(exact.length).toBeGreaterThan(0)
    for (const block of exact) {
      if (!block.sourceRange) throw new Error('expected exact range')
      expect(block.sourceRange.end).toBeGreaterThan(block.sourceRange.start)
      expect(page.content.slice(block.sourceRange.start, block.sourceRange.end)).toBe(block.content)
    }
  })

  it('uses the same real native PDF path for URL and Asset-backed sources', async () => {
    const bytes = await readFile(join(import.meta.dirname, 'fixtures', 'layout-aware-mixed.pdf'))
    const describe = vi.fn(async () => ({ text: 'Visual appendix.' }))
    const [urlDocument] = await collect(urlSource('https://example.com/layout.pdf', {
      namespace: 'kb', media: { describe },
      fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
    }).documents())
    const asset = { type: 'data' as const, data: new Uint8Array(bytes), mediaType: 'application/pdf', filename: 'layout.pdf' }
    const [assetDocument] = await collect(fileSource(asset, {
      namespace: 'kb', sourceId: 'asset:layout', media: { describe },
    }).documents())

    expect(describe).toHaveBeenCalledTimes(2)
    for (const document of [urlDocument, assetDocument]) {
      expect(document.title).toBe('Firecrawl Documentation - API Reference')
      expect(document.parts).toHaveLength(8)
      expect(document.parts[0]).toMatchObject({ kind: 'page', pageNumber: 1, blocks: expect.any(Array) })
      expect(document.parts[7]).toMatchObject({ kind: 'page', pageNumber: 8, content: 'Visual appendix.' })
    }
  })

  it.each([
    ['missing pages', {}, ['Fallback text']],
    ['non-array pages', { pages: {} }, ['Fallback text']],
    ['too few pages', { pages: [] }, ['Fallback text']],
    ['too many pages', { pages: [nativePage(0), nativePage(1)] }, ['Fallback text']],
    ['non-object page', { pages: [null] }, ['Fallback text']],
    ['array page', { pages: [[0, 'Native text', false]] }, ['Fallback text']],
    ['duplicate page', { pages: [nativePage(0), nativePage(0)] }, ['Fallback text', 'Second fallback']],
    ['missing page value', { pages: [{ markdown: 'x', needsOcr: false }] }, ['Fallback text']],
    ['unordered page', { pages: [nativePage(1), nativePage(0)] }, ['Fallback text', 'Second fallback']],
    ['missing ordinal', { pages: [nativePage(0), nativePage(2)] }, ['Fallback text', 'Second fallback']],
    ['fractional page', { pages: [nativePage(0.5)] }, ['Fallback text']],
    ['NaN page', { pages: [nativePage(Number.NaN)] }, ['Fallback text']],
    ['infinite page', { pages: [nativePage(Number.POSITIVE_INFINITY)] }, ['Fallback text']],
    ['non-string markdown', { pages: [{ page: 0, markdown: 1, needsOcr: false }] }, ['Fallback text']],
    ['non-boolean needsOcr', { pages: [{ page: 0, markdown: 'x', needsOcr: 0 }] }, ['Fallback text']],
  ])('falls back document-wide for invalid native output: %s', async (_name, nativeResult, fallbackPages) => {
    vi.doMock('@firecrawl/pdf-inspector', () => ({ extractPagesMarkdown: () => nativeResult }))
    const dir = await makeTempDir()
    const path = join(dir, 'invalid-native.pdf')
    await writeFile(path, makePdf(fallbackPages))

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(document.parts).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Fallback text', pageNumber: 1 })]))
    expect((document.parts[0] as { blocks?: unknown }).blocks).toBeUndefined()
    expect(document.warnings).toEqual([{
      code: 'parser_warning',
      message: `PDF source "${path}" used the pdfjs-dist fallback because layout-aware extraction was unavailable; document structure may be reduced.`,
      metadata: { primaryParser: 'pdf-inspector', fallbackParser: 'pdfjs-dist', reason: 'invalid_result' },
    }])
    vi.doUnmock('@firecrawl/pdf-inspector')
  })

  it('uses closed fallback reasons for unavailable and throwing native extraction', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'native-failure.pdf')
    await writeFile(path, makePdf('Fallback text'))

    vi.doMock('@firecrawl/pdf-inspector', () => { throw new Error('missing platform binary') })
    const [unavailable] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    expect(unavailable.warnings).toEqual([fallbackWarning(path, 'backend_unavailable')])
    vi.doUnmock('@firecrawl/pdf-inspector')

    vi.doMock('@firecrawl/pdf-inspector', () => ({ extractPagesMarkdown: () => { throw new Error('native secret') } }))
    const [failed] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    expect(failed.warnings).toEqual([fallbackWarning(path, 'extraction_failed')])
    expect(JSON.stringify(failed.warnings)).not.toContain('native secret')
    vi.doUnmock('@firecrawl/pdf-inspector')
  })

  it('keeps native pages when metadata throws synchronously and destroys the loading task', async () => {
    const fixture = join(import.meta.dirname, 'fixtures', 'layout-aware-mixed.pdf')
    const destroy = vi.fn(async () => undefined)
    mockPdfJs({ numPages: 8, getMetadata: () => { throw new Error('metadata unavailable') } }, destroy)
    const describe = vi.fn(async () => ({ text: 'Visual appendix.' }))

    const [document] = await collect(fileSource(fixture, { namespace: 'kb', media: { describe } }).documents())

    expect(document.title).toBe('layout-aware-mixed.pdf')
    expect(document.parts).toHaveLength(8)
    expect(document.parts[0]).toMatchObject({ kind: 'page', pageNumber: 1, blocks: expect.any(Array) })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps native pages when metadata rejects asynchronously and destroys the loading task', async () => {
    const fixture = join(import.meta.dirname, 'fixtures', 'layout-aware-mixed.pdf')
    const destroy = vi.fn(async () => undefined)
    mockPdfJs({ numPages: 8, getMetadata: async () => { throw new Error('metadata unavailable') } }, destroy)
    const describe = vi.fn(async () => ({ text: 'Visual appendix.' }))

    const [document] = await collect(fileSource(fixture, { namespace: 'kb', media: { describe } }).documents())

    expect(document.title).toBe('layout-aware-mixed.pdf')
    expect(document.parts).toHaveLength(8)
    expect(document.parts[0]).toMatchObject({ kind: 'page', pageNumber: 1, blocks: expect.any(Array) })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('preserves fallback failure as parse_failed, emits no downgrade, and destroys the loading task', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'broken-fallback.pdf')
    await writeFile(path, makePdf('Unreadable fallback'))
    const destroy = vi.fn(async () => undefined)
    mockPdfJs({
      numPages: 1,
      getMetadata: async () => ({ info: { Title: 'Ignored' } }),
      getPage: async () => { throw new Error('fallback extraction failed') },
    }, destroy)
    vi.doMock('@firecrawl/pdf-inspector', () => ({ extractPagesMarkdown: () => { throw new Error('native extraction failed') } }))

    const results = await collect(fileSource(path, { namespace: 'kb' }).load())

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      ok: false,
      sourceId: path,
      error: { code: 'parse_failed', parser: 'pdf', message: 'fallback extraction failed' },
    })
    expect(JSON.stringify(results)).not.toContain('document structure may be reduced')
    expect(JSON.stringify(results)).not.toContain('native extraction failed')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the loading task after a successful document-wide fallback', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'fallback-cleanup.pdf')
    await writeFile(path, makePdf('placeholder'))
    const destroy = vi.fn(async () => undefined)
    mockPdfJs({
      numPages: 1,
      getMetadata: async () => ({ info: { Title: 'Fallback title' } }),
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Fallback text', hasEOL: false }] }) }),
    }, destroy)
    vi.doMock('@firecrawl/pdf-inspector', () => ({ extractPagesMarkdown: () => ({ pages: [] }) }))

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(document.title).toBe('Fallback title')
    expect(document.parts).toMatchObject([{ kind: 'page', pageNumber: 1, content: 'Fallback text' }])
    expect(document.warnings).toEqual([fallbackWarning(path, 'invalid_result')])
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the loading task when opening the PDF fails', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'open-failure.pdf')
    await writeFile(path, makePdf('placeholder'))
    const destroy = vi.fn(async () => undefined)
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      getDocument: () => ({ promise: Promise.reject(new Error('PDF open failed')), destroy }),
    }))

    const results = await collect(fileSource(path, { namespace: 'kb' }).load())

    expect(results[0]).toMatchObject({
      ok: false,
      error: { code: 'parse_failed', parser: 'pdf', message: 'PDF open failed' },
    })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('provides URL and Asset fallback evidence with every physical page and one exact warning', async () => {
    const bytes = makePdf(['First fallback', 'Second fallback'])
    vi.doMock('@firecrawl/pdf-inspector', () => ({ extractPagesMarkdown: () => ({ pages: [] }) }))
    const [urlDocument] = await collect(urlSource('https://example.com/fallback.pdf', {
      namespace: 'kb',
      fetch: async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/pdf' } }),
    }).documents())
    const [assetDocument] = await collect(fileSource({
      type: 'data', data: new Uint8Array(bytes), mediaType: 'application/pdf', filename: 'fallback.pdf',
    }, { namespace: 'kb', sourceId: 'asset:fallback' }).documents())

    expect(urlDocument.parts.map((part) => part.kind === 'page' ? [part.pageNumber, part.content] : undefined)).toEqual([
      [1, 'First fallback'], [2, 'Second fallback'],
    ])
    expect(assetDocument.parts.map((part) => part.kind === 'page' ? [part.pageNumber, part.content] : undefined)).toEqual([
      [1, 'First fallback'], [2, 'Second fallback'],
    ])
    expect(urlDocument.warnings).toEqual([fallbackWarning('https://example.com/fallback.pdf', 'invalid_result')])
    expect(assetDocument.warnings).toEqual([fallbackWarning('asset:fallback', 'invalid_result')])
  })

  it('retains textless physical PDF pages without media description', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'mixed.pdf')
    await writeFile(path, makePdf(['First page', '', 'Third page']))

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())

    expect(document.parts).toMatchObject([
      { kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: '## First page' },
      { kind: 'page', pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 }, content: '' },
      { kind: 'page', pageNumber: 3, sourceLocation: { type: 'page', pageNumber: 3 }, content: '## Third page' },
    ])
    expect(document.content).toContain('[Page 2]')
    expect(document.warnings).toMatchObject([
      { code: 'partial_extraction', partId: 'pdf:page:2', metadata: { pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 } } },
    ])
  })

  it('retains textless PDF pages when media description is empty', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'visual-empty.pdf')
    await writeFile(path, makePdf(''))
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => ({ text: '  \n' }))

    const [document] = await collect(fileSource(path, { namespace: 'kb', media: { describe } }).documents())

    expect(describe).toHaveBeenCalledTimes(1)
    expect(document.parts).toMatchObject([
      { id: 'pdf:page:1', kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: '' },
    ])
    expect(document.warnings).toMatchObject([
      { code: 'partial_extraction', partId: 'pdf:page:1', metadata: { pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 } } },
    ])
  })

  it('retains textless PDF pages when media description throws', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'visual-throws.pdf')
    await writeFile(path, makePdf(['First page', '', 'Third page']))
    const describe = vi.fn(async (_input: Parameters<NonNullable<IngestMediaOperations['describe']>>[0]) => {
      throw new Error('vision unavailable')
    })

    const [document] = await collect(fileSource(path, { namespace: 'kb', media: { describe } }).documents())

    expect(describe).toHaveBeenCalledTimes(1)
    expect(document.parts).toMatchObject([
      { id: 'pdf:page:1', kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: '## First page' },
      { id: 'pdf:page:2', kind: 'page', pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 }, content: '' },
      { id: 'pdf:page:3', kind: 'page', pageNumber: 3, sourceLocation: { type: 'page', pageNumber: 3 }, content: '## Third page' },
    ])
    expect(document.warnings).toMatchObject([
      { code: 'partial_extraction', partId: 'pdf:page:2', metadata: { pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 } } },
    ])
    expect(document.warnings?.[0]?.message).toContain('media.describe failed: vision unavailable')
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

  it('renders xlsx numeric cells with their saved percentage format', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'percentage.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Percentages')
    sheet.getCell('A1').value = 'Rate'
    sheet.getCell('A2').value = 0.2
    sheet.getCell('A2').numFmt = '0%'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rows: [['Rate'], ['20%']],
      sourceRows: [
        { row: 1, cells: [{ row: 1, column: 1, address: 'A1', value: 'Rate' }] },
        { row: 2, cells: [{ row: 2, column: 1, address: 'A2', value: '20%' }] },
      ],
    })
    expect(table?.content).toBe('Rate\n20%')
  })

  it('renders xlsx cached formula results with number formats while retaining formulas', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'formula-percentage.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Formulas')
    sheet.getCell('A1').value = 'Rate'
    sheet.getCell('A2').value = { formula: '1/5', result: 0.2 }
    sheet.getCell('A2').numFmt = '0%'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rows: [['Rate'], ['20%']],
      sourceRows: [
        { row: 1 },
        { row: 2, cells: [{ row: 2, column: 1, address: 'A2', value: '20%', formula: '1/5' }] },
      ],
    })
    expect(table?.content).toBe('Rate\n20%')
  })

  it('renders xlsx rich text through rows, coordinates, columns, table content, and sheet content', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'rich-text.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('RichText')
    sheet.getCell('A1').value = { richText: [{ text: 'Plan' }, { text: ' Name' }] }
    sheet.getCell('B1').value = { richText: [{ text: 'Launch' }, { text: ' Notes' }] }
    sheet.getCell('A2').value = { richText: [{ text: 'Pro' }] }
    sheet.getCell('B2').value = { richText: [{ text: 'Ships ' }, { text: 'now' }] }
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')
    const sheetPart = document.parts.find((part) => part.kind === 'sheet')

    expect(table).toMatchObject({
      columns: ['Plan Name', 'Launch Notes'],
      rows: [
        ['Plan Name', 'Launch Notes'],
        ['Pro', 'Ships now'],
      ],
      sourceRows: [
        {
          row: 1,
          cells: [
            { row: 1, column: 1, address: 'A1', value: 'Plan Name' },
            { row: 1, column: 2, address: 'B1', value: 'Launch Notes' },
          ],
        },
        {
          row: 2,
          cells: [
            { row: 2, column: 1, address: 'A2', value: 'Pro' },
            { row: 2, column: 2, address: 'B2', value: 'Ships now' },
          ],
        },
      ],
    })
    expect(table?.content).toBe('Plan Name | Launch Notes\nPro | Ships now')
    expect(sheetPart?.content).toContain('Plan Name | Launch Notes')
    expect(sheetPart?.content).toContain('Pro | Ships now')
  })

  it('renders xlsx structured display values and translated shared formulas', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'structured-values.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Structured')
    sheet.addRow(['Link', 'Literal Error', 'Formula Error', 'Zero', 'False', 'Shared'])
    sheet.getCell('A2').value = { text: 'Crux docs', hyperlink: 'https://cruxjs.dev/docs' }
    sheet.getCell('B2').value = { error: '#DIV/0!' }
    sheet.getCell('C2').value = { formula: '1/0', result: { error: '#VALUE!' } }
    sheet.getCell('D2').value = { formula: '1-1', result: 0 }
    sheet.getCell('E2').value = { formula: 'D2=1', result: false }
    sheet.getCell('D3').value = 1
    sheet.fillFormula('F2:F3', 'D2+1', [1, 2])
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rows: [
        ['Link', 'Literal Error', 'Formula Error', 'Zero', 'False', 'Shared'],
        ['Crux docs', '#DIV/0!', '#VALUE!', '0', 'false', '1'],
        ['', '', '', '1', '', '2'],
      ],
      sourceRows: [
        {
          row: 1,
          cells: [
            { row: 1, column: 1, address: 'A1', value: 'Link' },
            { row: 1, column: 2, address: 'B1', value: 'Literal Error' },
            { row: 1, column: 3, address: 'C1', value: 'Formula Error' },
            { row: 1, column: 4, address: 'D1', value: 'Zero' },
            { row: 1, column: 5, address: 'E1', value: 'False' },
            { row: 1, column: 6, address: 'F1', value: 'Shared' },
          ],
        },
        {
          row: 2,
          cells: [
            { row: 2, column: 1, address: 'A2', value: 'Crux docs' },
            { row: 2, column: 2, address: 'B2', value: '#DIV/0!' },
            { row: 2, column: 3, address: 'C2', value: '#VALUE!', formula: '1/0' },
            { row: 2, column: 4, address: 'D2', value: '0', formula: '1-1' },
            { row: 2, column: 5, address: 'E2', value: 'false', formula: 'D2=1' },
            { row: 2, column: 6, address: 'F2', value: '1', formula: 'D2+1' },
          ],
        },
        {
          row: 3,
          cells: [
            { row: 3, column: 1, address: 'A3', value: '' },
            { row: 3, column: 2, address: 'B3', value: '' },
            { row: 3, column: 3, address: 'C3', value: '' },
            { row: 3, column: 4, address: 'D3', value: '1' },
            { row: 3, column: 5, address: 'E3', value: '' },
            { row: 3, column: 6, address: 'F3', value: '2', formula: 'D3+1' },
          ],
        },
      ],
    })
    expect(table?.content).toBe('Link | Literal Error | Formula Error | Zero | False | Shared\nCrux docs | #DIV/0! | #VALUE! | 0 | false | 1\n |  |  | 1 |  | 2')
  })

  it('renders xlsx plain numeric cells without explicit number formats as raw values', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'plain-numeric.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('PlainNumbers')
    sheet.getCell('A1').value = 'Metric'
    sheet.getCell('B1').value = 'Value'
    sheet.getCell('A2').value = 'Users'
    sheet.getCell('B2').value = 1234.5
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rows: [
        ['Metric', 'Value'],
        ['Users', '1234.5'],
      ],
      sourceRows: [
        {
          row: 1,
          cells: [
            { row: 1, column: 1, address: 'A1', value: 'Metric' },
            { row: 1, column: 2, address: 'B1', value: 'Value' },
          ],
        },
        {
          row: 2,
          cells: [
            { row: 2, column: 1, address: 'A2', value: 'Users' },
            { row: 2, column: 2, address: 'B2', value: '1234.5' },
          ],
        },
      ],
    })
    expect(table?.content).toBe('Metric | Value\nUsers | 1234.5')
    expect(document.warnings).toBeUndefined()
  })

  it('renders xlsx currency cells with their saved number format', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'currency.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Currency')
    sheet.getCell('A1').value = 'Amount'
    sheet.getCell('A2').value = 1234.5
    sheet.getCell('A2').numFmt = '$#,##0.00'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({ rows: [['Amount'], ['$1,234.50']] })
    expect(table?.sourceRows?.[1]?.cells[0]?.value).toBe('$1,234.50')
    expect(table?.content).toBe('Amount\n$1,234.50')
  })

  it('renders xlsx date cells with their saved date format', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'dates.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Dates')
    sheet.getCell('A1').value = 'Due'
    sheet.getCell('A2').value = new Date(Date.UTC(2024, 0, 2))
    sheet.getCell('A2').numFmt = 'yyyy-mm-dd'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({ rows: [['Due'], ['2024-01-02']] })
    expect(table?.sourceRows?.[1]?.cells[0]?.value).toBe('2024-01-02')
    expect(table?.content).toBe('Due\n2024-01-02')
  })

  it('renders xlsx dates from workbooks using the 1904 date system', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'dates-1904.xlsx')
    const workbook = new ExcelJS.Workbook()
    workbook.properties.date1904 = true
    const sheet = workbook.addWorksheet('Dates1904')
    sheet.getCell('A1').value = 'Day'
    sheet.getCell('A2').value = 1
    sheet.getCell('A2').numFmt = 'yyyy-mm-dd'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({ rows: [['Day'], ['1904-01-02']] })
    expect(table?.sourceRows?.[1]?.cells[0]?.value).toBe('1904-01-02')
    expect(table?.content).toBe('Day\n1904-01-02')
  })

  it('falls back to raw xlsx values and warns when a number format cannot be rendered', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'bad-format.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('BadFormat')
    sheet.getCell('A1').value = 'Amount'
    sheet.getCell('A2').value = 12.5
    sheet.getCell('A2').numFmt = '0n'
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({ rows: [['Amount'], ['12.5']] })
    expect(table?.sourceRows?.[1]?.cells[0]?.value).toBe('12.5')
    expect(table?.content).toBe('Amount\n12.5')
    expect(document.warnings).toEqual([
      expect.objectContaining({
        code: 'parser_warning',
        message: expect.stringContaining('cell A2'),
        metadata: expect.objectContaining({ sheetName: 'BadFormat', address: 'A2', numFmt: '0n' }),
      }),
    ])
  })

  it('retains xlsx source coordinates across skipped blank rows', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'sparse.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sparse')
    sheet.getCell('A3').value = 'Plan'
    sheet.getCell('B3').value = 'Price'
    sheet.getCell('A5').value = 'Pro'
    sheet.getCell('B5').value = 20
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      kind: 'table',
      rowStart: 3,
      rowEnd: 5,
      rows: [
        ['Plan', 'Price'],
        ['Pro', '20'],
      ],
      sourceRows: [
        {
          row: 3,
          cells: [
            { row: 3, column: 1, address: 'A3', value: 'Plan' },
            { row: 3, column: 2, address: 'B3', value: 'Price' },
          ],
        },
        {
          row: 5,
          cells: [
            { row: 5, column: 1, address: 'A5', value: 'Pro' },
            { row: 5, column: 2, address: 'B5', value: '20' },
          ],
        },
      ],
    })
  })

  it('anchors xlsx rows and ranges after leading blank columns', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'offset.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Offset')
    sheet.getCell('B2').value = 'Plan'
    sheet.getCell('C2').value = 'Price'
    sheet.getCell('B4').value = 'Pro'
    sheet.getCell('C4').value = 20
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')
    const sheetPart = document.parts.find((part) => part.kind === 'sheet')

    expect(table).toMatchObject({
      rows: [
        ['Plan', 'Price'],
        ['Pro', '20'],
      ],
      sourceRange: {
        address: 'B2:C4',
        rowStart: 2,
        rowEnd: 4,
        columnStart: 2,
        columnEnd: 3,
      },
      sourceRows: [
        {
          row: 2,
          cells: [
            { row: 2, column: 2, address: 'B2', value: 'Plan' },
            { row: 2, column: 3, address: 'C2', value: 'Price' },
          ],
        },
        {
          row: 4,
          cells: [
            { row: 4, column: 2, address: 'B4', value: 'Pro' },
            { row: 4, column: 3, address: 'C4', value: '20' },
          ],
        },
      ],
    })
    expect(sheetPart).toMatchObject({ sourceRange: table?.sourceRange })
    expect(table?.content).toBe('Plan | Price\nPro | 20')
  })

  it('retains xlsx source coordinates for sparse cells across the sheet range', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'sparse-cells.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('SparseCells')
    sheet.getCell('B2').value = 'Plan'
    sheet.getCell('D2').value = 'Price'
    sheet.getCell('B4').value = 'Pro'
    sheet.getCell('D5').value = 20
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rowStart: 2,
      rowEnd: 5,
      rows: [
        ['Plan', '', 'Price'],
        ['Pro', '', ''],
        ['', '', '20'],
      ],
      sourceRange: {
        address: 'B2:D5',
        rowStart: 2,
        rowEnd: 5,
        columnStart: 2,
        columnEnd: 4,
      },
      sourceRows: [
        {
          row: 2,
          address: 'B2:D2',
          sourceRange: { address: 'B2:D2', rowStart: 2, rowEnd: 2, columnStart: 2, columnEnd: 4 },
          cells: [
            { row: 2, column: 2, address: 'B2', value: 'Plan' },
            { row: 2, column: 3, address: 'C2', value: '' },
            { row: 2, column: 4, address: 'D2', value: 'Price' },
          ],
        },
        {
          row: 4,
          address: 'B4:D4',
          sourceRange: { address: 'B4:D4', rowStart: 4, rowEnd: 4, columnStart: 2, columnEnd: 4 },
          cells: [
            { row: 4, column: 2, address: 'B4', value: 'Pro' },
            { row: 4, column: 3, address: 'C4', value: '' },
            { row: 4, column: 4, address: 'D4', value: '' },
          ],
        },
        {
          row: 5,
          address: 'B5:D5',
          sourceRange: { address: 'B5:D5', rowStart: 5, rowEnd: 5, columnStart: 2, columnEnd: 4 },
          cells: [
            { row: 5, column: 2, address: 'B5', value: '' },
            { row: 5, column: 3, address: 'C5', value: '' },
            { row: 5, column: 4, address: 'D5', value: '20' },
          ],
        },
      ],
    })
    expect(table?.content).toBe('Plan |  | Price\nPro |  | \n |  | 20')
  })

  it('retains xlsx displayed formula values, expressions, and ranges', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'formulas.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Formulas')
    sheet.getCell('C7').value = 'Item'
    sheet.getCell('D7').value = 'Price'
    sheet.getCell('E7').value = 'Total'
    sheet.getCell('C8').value = 'Pro'
    sheet.getCell('D8').value = 20
    sheet.getCell('E8').value = { formula: 'D8*2', result: 40 }
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    expect(table).toMatchObject({
      rowStart: 7,
      rowEnd: 8,
      rows: [
        ['Item', 'Price', 'Total'],
        ['Pro', '20', '40'],
      ],
      sourceRange: {
        address: 'C7:E8',
        rowStart: 7,
        rowEnd: 8,
        columnStart: 3,
        columnEnd: 5,
      },
      sourceRows: [
        { row: 7 },
        {
          row: 8,
          cells: [
            { row: 8, column: 3, address: 'C8', value: 'Pro' },
            { row: 8, column: 4, address: 'D8', value: '20' },
            { row: 8, column: 5, address: 'E8', value: '40', formula: 'D8*2' },
          ],
        },
      ],
    })
    expect(table?.content).toBe('Item | Price | Total\nPro | 20 | 40')
  })

  it('retains xlsx merged-cell descriptors while only masters own values and formulas', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'merged.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Merges')
    sheet.mergeCells('A1:C1')
    sheet.getCell('A1').value = { richText: [{ text: 'Wide' }, { text: ' Header' }] }
    sheet.mergeCells('E2:E4')
    sheet.getCell('E2').value = { richText: [{ text: 'Tall' }, { text: ' Header' }] }
    sheet.mergeCells('G2:G4')
    sheet.getCell('G2').value = { formula: '10*2', result: 20 }
    await workbook.xlsx.writeFile(path)

    const [document] = await collect(fileSource(path, { namespace: 'kb' }).documents())
    const table = document.parts.find((part) => part.kind === 'table')

    const horizontalMerge = {
      master: 'A1',
      sourceRange: { address: 'A1:C1', rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 3 },
    }
    const verticalRichTextMerge = {
      master: 'E2',
      sourceRange: { address: 'E2:E4', rowStart: 2, rowEnd: 4, columnStart: 5, columnEnd: 5 },
    }
    const verticalFormulaMerge = {
      master: 'G2',
      sourceRange: { address: 'G2:G4', rowStart: 2, rowEnd: 4, columnStart: 7, columnEnd: 7 },
    }

    expect(table).toMatchObject({
      rows: [
        ['Wide Header', '', '', '', '', '', ''],
        ['', '', '', '', 'Tall Header', '', '20'],
        ['', '', '', '', '', '', ''],
        ['', '', '', '', '', '', ''],
      ],
      sourceRange: { address: 'A1:G4', rowStart: 1, rowEnd: 4, columnStart: 1, columnEnd: 7 },
      sourceRows: [
        {
          row: 1,
          cells: [
            { row: 1, column: 1, address: 'A1', value: 'Wide Header', merge: horizontalMerge },
            { row: 1, column: 2, address: 'B1', value: '', merge: horizontalMerge },
            { row: 1, column: 3, address: 'C1', value: '', merge: horizontalMerge },
            { row: 1, column: 4, address: 'D1', value: '' },
            { row: 1, column: 5, address: 'E1', value: '' },
            { row: 1, column: 6, address: 'F1', value: '' },
            { row: 1, column: 7, address: 'G1', value: '' },
          ],
        },
        {
          row: 2,
          cells: [
            { row: 2, column: 1, address: 'A2', value: '' },
            { row: 2, column: 2, address: 'B2', value: '' },
            { row: 2, column: 3, address: 'C2', value: '' },
            { row: 2, column: 4, address: 'D2', value: '' },
            { row: 2, column: 5, address: 'E2', value: 'Tall Header', merge: verticalRichTextMerge },
            { row: 2, column: 6, address: 'F2', value: '' },
            { row: 2, column: 7, address: 'G2', value: '20', formula: '10*2', merge: verticalFormulaMerge },
          ],
        },
        {
          row: 3,
          cells: [
            { row: 3, column: 1, address: 'A3', value: '' },
            { row: 3, column: 2, address: 'B3', value: '' },
            { row: 3, column: 3, address: 'C3', value: '' },
            { row: 3, column: 4, address: 'D3', value: '' },
            { row: 3, column: 5, address: 'E3', value: '', merge: verticalRichTextMerge },
            { row: 3, column: 6, address: 'F3', value: '' },
            { row: 3, column: 7, address: 'G3', value: '', merge: verticalFormulaMerge },
          ],
        },
        {
          row: 4,
          cells: [
            { row: 4, column: 1, address: 'A4', value: '' },
            { row: 4, column: 2, address: 'B4', value: '' },
            { row: 4, column: 3, address: 'C4', value: '' },
            { row: 4, column: 4, address: 'D4', value: '' },
            { row: 4, column: 5, address: 'E4', value: '', merge: verticalRichTextMerge },
            { row: 4, column: 6, address: 'F4', value: '' },
            { row: 4, column: 7, address: 'G4', value: '', merge: verticalFormulaMerge },
          ],
        },
      ],
    })
    expect(table?.sourceRows?.[0]?.cells[1]).not.toHaveProperty('formula')
    expect(table?.sourceRows?.[2]?.cells[6]).not.toHaveProperty('formula')
    expect(table?.content).toBe('Wide Header |  |  |  |  |  | \n |  |  |  | Tall Header |  | 20\n |  |  |  |  |  | \n |  |  |  |  |  | ')
  })

  it('warns safely for unknown xlsx structured values without emitting object strings', () => {
    const warnings: unknown[] = []

    const value = projectXlsxDisplayValue(
      { unexpected: 'shape', toString: () => '[object Object]' },
      { sheetName: 'Mystery', address: 'C9', warn: (warning) => warnings.push(warning) },
    )
    const textOnlyValue = projectXlsxDisplayValue(
      { text: 'loose text', toString: () => 'leaked text object' },
      { sheetName: 'Mystery', address: 'D9', warn: (warning) => warnings.push(warning) },
    )
    const resultOnlyValue = projectXlsxDisplayValue(
      { result: 'cached value', toString: () => 'leaked result object' },
      { sheetName: 'Mystery', address: 'E9', warn: (warning) => warnings.push(warning) },
    )

    expect(value).toBe('')
    expect(textOnlyValue).toBe('')
    expect(resultOnlyValue).toBe('')
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'parser_warning',
        message: expect.stringContaining('cell C9'),
        metadata: { sheetName: 'Mystery', address: 'C9', valueShape: 'unknown' },
      }),
      expect.objectContaining({
        code: 'parser_warning',
        message: expect.stringContaining('cell D9'),
        metadata: { sheetName: 'Mystery', address: 'D9', valueShape: 'textOnly' },
      }),
      expect.objectContaining({
        code: 'parser_warning',
        message: expect.stringContaining('cell E9'),
        metadata: { sheetName: 'Mystery', address: 'E9', valueShape: 'resultOnly' },
      }),
    ])
    expect(JSON.stringify(warnings)).not.toContain('[object Object]')
    expect(JSON.stringify(warnings)).not.toContain('loose text')
    expect(JSON.stringify(warnings)).not.toContain('cached value')
    expect(JSON.stringify(warnings)).not.toContain('leaked')
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

function makePdf(text: string | string[]): Buffer {
  const pages = Array.isArray(text) ? text : [text]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pages.flatMap((pageText, index) => {
      const pageObject = 3 + index * 3
      const contentsObject = pageObject + 1
      const fontObject = pageObject + 2
      const stream = pageText ? `BT\n/F1 24 Tf\n72 100 Td\n(${escapePdfText(pageText)}) Tj\nET` : 'q\nQ'
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentsObject} 0 R /Resources << /Font << /F1 ${fontObject} 0 R >> >> >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ]
    }),
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

function nativePage(page: number): { page: number; markdown: string; needsOcr: boolean } {
  return { page, markdown: 'Native text', needsOcr: false }
}

function fallbackWarning(sourceId: string, reason: 'backend_unavailable' | 'extraction_failed' | 'invalid_result') {
  return {
    code: 'parser_warning',
    message: `PDF source "${sourceId}" used the pdfjs-dist fallback because layout-aware extraction was unavailable; document structure may be reduced.`,
    metadata: { primaryParser: 'pdf-inspector', fallbackParser: 'pdfjs-dist', reason },
  }
}

function mockPdfJs(
  document: {
    readonly numPages: number
    readonly getMetadata: () => unknown
    readonly getPage?: (pageNumber: number) => Promise<unknown>
  },
  destroy: () => Promise<unknown>,
): void {
  vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument: () => ({ promise: Promise.resolve(document), destroy }),
  }))
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
