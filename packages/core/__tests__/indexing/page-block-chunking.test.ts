import { describe, expect, it } from 'vitest'
import { chunker } from '../../src/indexing'
import type { CruxDocument } from '../../src/indexing'

describe('structured page block chunking', () => {
  it('bumps only the structured strategy identity', () => {
    expect(chunker.structured().version).toBe('3')
    expect(chunker.text().version).toBe('2')
    expect(chunker.parentChild().version).toBe('2')
    expect(chunker.semantic({ strategy: 'custom', segment: () => [] }).version).toBe('2')
  })

  it('keeps heading-defined narrative sections separate and repeats their compact prefix', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'sections',
      content: '# Guide\n\nFirst sentence. Second sentence.\n\n### Detail\n\nList item',
      parts: [{
        id: 'page:1',
        kind: 'page',
        pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 },
        content: '# Guide\n\nFirst sentence. Second sentence.\n\n### Detail\n\nList item',
        blocks: [
          { id: 'h1', kind: 'text', role: 'heading', content: '# Guide', headingPath: ['Guide'] },
          { id: 'p1', kind: 'text', role: 'paragraph', content: 'First sentence. Second sentence.', headingPath: ['Guide'] },
          { id: 'h3', kind: 'text', role: 'heading', content: '### Detail', headingPath: ['Guide', 'Detail'] },
          { id: 'l1', kind: 'text', role: 'list', content: 'List item', headingPath: ['Guide', 'Detail'] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 18, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 18, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Guide\n\nFirst sentence. ',
      '# Guide\n\nSecond sentence.',
      '# Guide\n## Detail\n\nList item',
    ])
    expect(result.chunks.map((chunk) => chunk.provenance)).toEqual([
      expect.objectContaining({ partIds: ['page:1'], pages: [1], blockIds: ['h1', 'p1'], confidence: 'derived' }),
      expect.objectContaining({ partIds: ['page:1'], pages: [1], blockIds: ['h1', 'p1'], confidence: 'derived' }),
      expect.objectContaining({ partIds: ['page:1'], pages: [1], blockIds: ['h1', 'h3', 'l1'], confidence: 'derived' }),
    ])
    result.chunks.forEach((chunk) => {
      expect(chunk.provenance?.sourceLocations).toEqual([{ type: 'page', pageNumber: 1 }])
      expect(chunk.provenance?.sourceSpans).toBeUndefined()
    })
  })

  it('replaces repeated heading leaf provenance while retaining its ancestors', async () => {
    const content = '# Guide\n\n## Details\n\nFirst body\n\n## Details\n\nSecond body\n\n| Item |\n| --- |\n| Later |'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'repeated-heading', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'guide', kind: 'text', role: 'heading', content: '# Guide', headingPath: ['Guide'] },
          {
            id: 'first-details', kind: 'text', role: 'heading', content: '## Details',
            headingPath: ['Guide', 'Details'],
          },
          {
            id: 'first-body', kind: 'text', role: 'paragraph', content: 'First body',
            headingPath: ['Guide', 'Details'],
          },
          {
            id: 'second-details', kind: 'text', role: 'heading', content: '## Details',
            headingPath: ['Guide', 'Details'],
          },
          {
            id: 'second-body', kind: 'text', role: 'paragraph', content: 'Second body',
            headingPath: ['Guide', 'Details'],
          },
          {
            id: 'later-table', kind: 'table', content: '| Item |\n| --- |\n| Later |',
            headingPath: ['Guide', 'Details'], columns: ['Item'], rows: [['Later']],
          },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 100, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
    const chunkFor = (text: string) => result.chunks.find((chunk) => chunk.content.includes(text))

    expect(chunkFor('First body')?.provenance?.blockIds).toEqual(['guide', 'first-details', 'first-body'])
    expect(chunkFor('Second body')?.provenance?.blockIds).toEqual(['guide', 'second-details', 'second-body'])
    expect(chunkFor('| Item |')?.provenance?.blockIds).toEqual(['guide', 'second-details', 'later-table'])
  })

  it('retains pre-heading, fitting narrative, empty-visible headings, and heading-only sections', async () => {
    const pageContent = 'Before\n\n# Alpha\n\nParagraph\n\n- List\n\n```\ncode\n```\n\n##\n\n# Empty\n\n### Nested'
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'narrative-shapes',
      content: pageContent,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: pageContent,
        blocks: [
          { id: 'before', kind: 'text', role: 'other', content: 'Before' },
          { id: 'alpha', kind: 'text', role: 'heading', content: '# Alpha', headingPath: ['Alpha'] },
          { id: 'paragraph', kind: 'text', role: 'paragraph', content: 'Paragraph', headingPath: ['Alpha'] },
          { id: 'list', kind: 'text', role: 'list', content: '- List', headingPath: ['Alpha'] },
          { id: 'code', kind: 'text', role: 'code', content: '```\ncode\n```', headingPath: ['Alpha'] },
          { id: 'empty-visible', kind: 'text', role: 'other', content: '##', headingPath: ['Alpha'] },
          { id: 'empty', kind: 'text', role: 'heading', content: '# Empty', headingPath: ['Empty'] },
          { id: 'nested', kind: 'text', role: 'heading', content: '### Nested', headingPath: ['Empty', 'Nested'] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 100, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      'Before',
      '# Alpha\n\nParagraph\n\n- List\n\n```\ncode\n```\n\n##',
      '# Empty',
      '# Empty\n## Nested',
    ])
  })

  it('retains authored heading-role blocks without usable heading ancestry as narrative', async () => {
    const content = '# Missing\n\n# Empty'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'heading-without-ancestry', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 }, content,
        blocks: [
          { id: 'missing-path', kind: 'text', role: 'heading', content: '# Missing' },
          { id: 'empty-path', kind: 'text', role: 'heading', content: '# Empty', headingPath: [] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 9, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 9, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual(['# Missing', '# Empty'])
    expect(result.chunks.map((chunk) => chunk.provenance)).toEqual([
      {
        partIds: ['page:1'], blockIds: ['missing-path'], pages: [1],
        sourceLocations: [{ type: 'page', pageNumber: 1 }], confidence: 'derived',
      },
      {
        partIds: ['page:1'], blockIds: ['empty-path'], pages: [1],
        sourceLocations: [{ type: 'page', pageNumber: 1 }], confidence: 'derived',
      },
    ])
  })

  it('retains active heading context for heading-role narrative without usable ancestry', async () => {
    const content = '# Alpha\n\n# Missing\n\n# Empty'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'heading-without-ancestry-in-section', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'alpha', kind: 'text', role: 'heading', content: '# Alpha', headingPath: ['Alpha'] },
          { id: 'missing-path', kind: 'text', role: 'heading', content: '# Missing' },
          { id: 'empty-path', kind: 'text', role: 'heading', content: '# Empty', headingPath: [] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 100, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Alpha\n\n# Missing\n\n# Empty',
    ])
    expect(result.chunks[0]?.content.match(/# Alpha/g)).toHaveLength(1)
    expect(result.chunks[0]?.provenance?.blockIds).toEqual(['alpha', 'missing-path', 'empty-path'])
  })

  it('retains configured overlap when splitting an oversized prefixed narrative block', async () => {
    const content = '# Guide\n\nFirst sentence. Second sentence. Third sentence.'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'prefixed-overlap', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Guide', headingPath: ['Guide'] },
          {
            id: 'body', kind: 'text', role: 'paragraph',
            content: 'First sentence. Second sentence. Third sentence.', headingPath: ['Guide'],
          },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 25, overlapChars: 7 })
      .chunkDocument(document, { chunking: { maxChars: 25, overlapChars: 7 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Guide\n\nFirst sentence. ',
      '# Guide\n\ntence. Second sentence. ',
      '# Guide\n\ntence. Third sentence.',
    ])
    result.chunks.forEach((chunk) => {
      expect(chunk.content.match(/# Guide/g)).toHaveLength(1)
      expect(chunk.provenance).toMatchObject({
        partIds: ['page:1'], blockIds: ['heading', 'body'], pages: [1], confidence: 'derived',
      })
      expect(chunk.provenance?.sourceSpans).toBeUndefined()
    })
  })

  it('accounts for body separators while treating heading context as soft overhead', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'budgets', content: '12345\n\n6789\n\n# Very long heading\n\nx\n\n# Heading only',
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: '12345\n\n6789\n\n# Very long heading\n\nx\n\n# Heading only',
        blocks: [
          { id: 'a', kind: 'text', role: 'paragraph', content: '12345' },
          { id: 'b', kind: 'text', role: 'paragraph', content: '6789' },
          { id: 'long', kind: 'text', role: 'heading', content: '# Very long heading', headingPath: ['Very long heading'] },
          { id: 'x', kind: 'text', role: 'paragraph', content: 'x', headingPath: ['Very long heading'] },
          { id: 'only', kind: 'text', role: 'heading', content: '# Heading only', headingPath: ['Heading only'] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 10, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 10, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '12345',
      '6789',
      '# Very long heading\n\nx',
      '# Heading only',
    ])
  })

  it('preserves table blocks as indivisible boundaries between narrative chunks', async () => {
    const content = '# Results\n\nBefore\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n\nAfter'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'interleaved-table', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 }, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'],
            content: '| Name | Score |\n| --- | --- |\n| Ada | 10 |',
            columns: ['Name', 'Score'], rows: [['Ada', '10']],
          },
          { id: 'after', kind: 'text', role: 'paragraph', content: 'After', headingPath: ['Results'] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 100, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Results\n\nBefore',
      '# Results\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |',
      '# Results\n\nAfter',
    ])
    expect(result.chunks[1]?.provenance).toEqual({
      partIds: ['page:1'],
      blockIds: ['heading', 'scores'],
      pages: [1],
      tables: ['scores'],
      sourceLocations: [{ type: 'page', pageNumber: 1 }],
      confidence: 'derived',
    })
  })

  it('keeps text chunking flat and its version-2 fingerprint unchanged', async () => {
    const content = '# Results\n\nBefore\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n\nAfter'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'flat-text', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'],
            content: '| Name | Score |\n| --- | --- |\n| Ada | 10 |',
            columns: ['Name', 'Score'], rows: [['Ada', '10']],
          },
          { id: 'after', kind: 'text', role: 'paragraph', content: 'After', headingPath: ['Results'] },
        ],
      }],
    }
    const strategy = chunker.text({ maxChars: 100, overlapChars: 0 })
    const result = await strategy.chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(strategy.version).toBe('2')
    expect(strategy.fingerprint()).toBe('398e0d11')
    expect(result.chunks.map((chunk) => chunk.content)).toEqual([content])
    expect(result.chunks[0]?.provenance?.blockIds).toEqual(['heading', 'before', 'scores', 'after'])
  })

  it('keeps parent-child materialization flat and its version-2 fingerprint unchanged', async () => {
    const content = '# Results\n\nBefore\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n\nAfter'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'flat-parent-child', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'],
            content: '| Name | Score |\n| --- | --- |\n| Ada | 10 |',
            columns: ['Name', 'Score'], rows: [['Ada', '10']],
          },
          { id: 'after', kind: 'text', role: 'paragraph', content: 'After', headingPath: ['Results'] },
        ],
      }],
    }
    const strategy = chunker.parentChild({
      parentMaxChars: 100, childMaxChars: 100, childOverlapChars: 0,
    })
    const result = await strategy.chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(strategy.version).toBe('2')
    expect(strategy.fingerprint()).toBe('62963a73')
    expect(result.parents?.map((parent) => parent.content)).toEqual([content])
    expect(result.chunks.map((chunk) => chunk.content)).toEqual([content])
    expect(result.parents?.[0]?.provenance?.blockIds).toEqual(['heading', 'before', 'scores', 'after'])
  })
})
