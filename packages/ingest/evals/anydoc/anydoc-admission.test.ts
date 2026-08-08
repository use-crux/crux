import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { admitAnydocDocument } from '../../private/anydoc-admission.mjs'

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
})
