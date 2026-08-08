import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { admitAnydocDocument } from '../../private/anydoc-admission.mjs'
import { extractAnydocNativeFacts } from '../../private/anydoc-native-facts.mjs'

const bytes = new TextEncoder().encode('source')

describe('private Anydoc admission projection', () => {
  it('rejects unknown and partial nested shapes instead of projecting plausible text', async () => {
    const raw = JSON.parse(await readFile(new URL('./fixtures/anydoc-0.1.7-raw-document.json', import.meta.url), 'utf8'))
    delete raw.$comment
    raw.blocks[0].content[0].unexpected = true
    expect(() => admitAnydocDocument(raw, bytes, 'docx')).toThrowError(expect.objectContaining({ code: 'invalid-result' }))
  })

  it('bounds deeply nested traversal', () => {
    let block: unknown = { kind: 'paragraph', content: [{ kind: 'text', text: 'leaf' }] }
    for (let index = 0; index < 130; index++) block = { kind: 'blockQuote', blocks: [block] }
    expect(() => admitAnydocDocument({ blocks: [block], notes: [], assets: [] }, bytes, 'docx')).toThrowError(expect.objectContaining({ code: 'expanded-too-large' }))
  })

  it('rejects dangling parser-owned note and asset relationships', () => {
    const document = { blocks: [{ kind: 'paragraph', content: [{ kind: 'image', alt: 'missing', source: { kind: 'asset', assetId: 7 } }] }], notes: [], assets: [] }
    expect(() => admitAnydocDocument(document, bytes, 'docx')).toThrowError(expect.objectContaining({ code: 'invalid-result' }))
  })

  it('accepts only the closed footnote and endnote note kinds', () => {
    const note = (kind: string) => ({
      blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'body' }] }],
      notes: [{ id: 'n1', kind, blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'note' }] }] }],
      assets: [],
    })

    expect(() => admitAnydocDocument(note('footnote'), bytes, 'docx')).not.toThrow()
    expect(() => admitAnydocDocument(note('endnote'), bytes, 'docx')).not.toThrow()
    expect(() => admitAnydocDocument(note('comment'), bytes, 'docx')).toThrowError(expect.objectContaining({ code: 'invalid-result' }))
  })

  it('accepts every closed Anydoc 0.1.7 union variant', () => {
    const markers = ['bullet', 'decimal', 'lowerAlpha', 'upperAlpha', 'lowerRoman', 'upperRoman']
    const blocks = [
      { kind: 'heading', level: 2, anchor: 'heading', content: [{ kind: 'anchor', anchor: 'inline' }] },
      { kind: 'codeBlock', lang: 'ts', text: 'code' },
      ...markers.map((marker) => ({ kind: 'list', list: { marker, start: 1, items: [{ checked: true, markerLabel: '1-a)', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: marker }] }] }] } })),
      { kind: 'table', table: { kind: 'layout', headerRows: 0, grid: [[{ kind: 'origin', cell: { blocks: [], colSpan: 2, rowSpan: 1 } }, { kind: 'covered', originRow: 0, originCol: 0 }]] } },
      { kind: 'paragraph', content: [
        { kind: 'link', content: [{ kind: 'text', text: 'relative' }], target: { kind: 'relative', value: '../x' } },
        { kind: 'link', content: [{ kind: 'text', text: 'anchor' }], target: { kind: 'anchor', value: 'heading' } },
        { kind: 'image', alt: 'remote', source: { kind: 'external', url: 'https://example.test/x.png' } },
        { kind: 'image', alt: 'missing', source: { kind: 'unavailable' } },
      ] },
    ]
    expect(() => admitAnydocDocument({ blocks, notes: [], assets: [] }, bytes, 'docx')).not.toThrow()
  })

  it('extracts parser-native facts independently from the Core projection', async () => {
    const raw = JSON.parse(await readFile(new URL('./fixtures/anydoc-0.1.7-raw-document.json', import.meta.url), 'utf8'))
    delete raw.$comment
    const admitted = admitAnydocDocument(raw, bytes, 'docx')
    const native = structuredClone(admitted.native)
    const core = structuredClone(admitted.core)
    ;(core.blocks as unknown[]).splice(0)
    ;(native.facts as unknown[]).splice(0)
    expect(native.facts).toHaveLength(0)
    expect(core.blocks).toHaveLength(0)
    expect(admitted.native.facts.some((fact) => fact.kind === 'heading')).toBe(true)
    expect(admitted.core.blocks.length).toBeGreaterThan(0)
    expect(extractAnydocNativeFacts(raw, bytes, admitted.core.producer).filter((fact) => fact.kind === 'heading')).toEqual([
      { kind: 'heading', level: 1, text: 'Release Notes', factPath: 'blocks/1' },
    ])
  })

  it('keeps native evidence stable when the Core projection is mutated', async () => {
    const raw = JSON.parse(await readFile(new URL('./fixtures/anydoc-0.1.7-raw-document.json', import.meta.url), 'utf8'))
    delete raw.$comment
    const nativeBefore = structuredClone(extractAnydocNativeFacts(raw, bytes, { kind: 'parser', name: 'anydoc', version: '0.1.7', adapterVersion: '2-admission' }))
    const admitted = admitAnydocDocument(raw, bytes, 'docx')
    admitted.core.blocks[0].text = 'projector regression'
    expect(extractAnydocNativeFacts(raw, bytes, admitted.core.producer)).toEqual(nativeBefore)
    expect(nativeBefore).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: 'projector regression' })]))
  })

  it('binds the observed block count and every table-cell descendant to native facts', () => {
    const raw = {
      blocks: [{ kind: 'table', table: { kind: 'data', headerRows: 0, grid: [[{
        kind: 'origin',
        cell: { blocks: [{ kind: 'list', list: { marker: 'bullet', start: 1, items: [{ blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'nested' }] }] }] } }] },
      }]] } }],
      notes: [],
      assets: [],
    }
    const admitted = admitAnydocDocument(raw, bytes, 'docx')

    expect(admitted.native.observed.blockCount).toBe(3)
    expect(admitted.native.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'block-count', count: 3, factPath: 'document' }),
      expect.objectContaining({ kind: 'block', factPath: 'blocks/1' }),
      expect.objectContaining({ kind: 'provenance', factPath: 'blocks/1/rows/1/columns/1' }),
      expect.objectContaining({ kind: 'block', factPath: 'blocks/1/rows/1/columns/1/blocks/1' }),
      expect.objectContaining({ kind: 'block', factPath: 'blocks/1/rows/1/columns/1/blocks/1/items/1/blocks/1' }),
      expect.objectContaining({ kind: 'block-text', text: 'nested', factPath: 'blocks/1/rows/1/columns/1/blocks/1/items/1/blocks/1' }),
    ]))
  })

  it('retains link, note, and image relationships without embedding asset bytes in native facts', async () => {
    const raw = {
      blocks: [{ kind: 'paragraph', content: [
        { kind: 'link', content: [{ kind: 'text', text: 'link' }], target: { kind: 'external', value: 'https://example.test' } },
        { kind: 'noteRef', noteId: 'n1' },
        { kind: 'image', alt: 'diagram', source: { kind: 'asset', assetId: 0 } },
      ] }],
      notes: [{ id: 'n1', kind: 'footnote', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'note' }] }] }],
      assets: [{ id: 0, mediaType: 'image/png', originPart: 'word/media/a.png', data: Buffer.from([1, 2, 3]) }],
    }
    const admitted = admitAnydocDocument(raw, bytes, 'docx')
    expect(admitted.relationships.inlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'link' }),
      expect.objectContaining({ kind: 'noteRef' }),
      expect.objectContaining({ kind: 'image' }),
    ]))
    expect(JSON.stringify(admitted.native)).not.toContain('AQID')
  })

  // Supervisor DecodeResult rejects any non-provenance fact whose factPath
  // lacks a provenance row (unbound native fact) and never sends ACK; the
  // worker then fails at stage=acknowledgement. Link facts use distinct
  // /inlines/N paths that must carry their own bound provenance.
  it('binds provenance to every native link fact path required before ACK', () => {
    const raw = {
      blocks: [{ kind: 'paragraph', content: [
        { kind: 'text', text: 'before ' },
        { kind: 'link', content: [{ kind: 'text', text: 'reference' }], target: { kind: 'external', value: 'https://cruxjs.dev/' } },
        { kind: 'text', text: '.' },
      ] }],
      notes: [],
      assets: [],
    }
    const admitted = admitAnydocDocument(raw, bytes, 'docx')
    const facts = admitted.native.facts as ReadonlyArray<{ readonly kind: string; readonly factPath: string; readonly path?: string; readonly text?: string; readonly target?: string }>
    const links = facts.filter((fact) => fact.kind === 'link')
    expect(links).toEqual([
      expect.objectContaining({ kind: 'link', text: 'reference', target: 'https://cruxjs.dev/', factPath: 'blocks/1/inlines/2' }),
    ])

    // Same binding rule DecodeResult enforces before writing ACK (and the
    // worker replying ACKED): every non-provenance factPath must be bound.
    const provenancePaths = new Set(
      facts.filter((fact) => fact.kind === 'provenance').map((fact) => fact.factPath),
    )
    for (const fact of facts) {
      if (fact.kind === 'provenance') {
        continue
      }
      expect(provenancePaths.has(fact.factPath)).toBe(true)
    }
    for (const link of links) {
      expect(facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'provenance', factPath: link.factPath, path: link.factPath }),
      ]))
    }
  })
})
