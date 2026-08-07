import { describe, expect, it, vi } from 'vitest'
import { chunker } from '../../src/indexing'
import type { CruxDocument } from '../../src/indexing'

describe('structured page block chunking', () => {
  it('bumps only page-block-aware strategy identities', () => {
    expect(chunker.structured().version).toBe('3')
    expect(chunker.text().version).toBe('2')
    expect(chunker.parentChild().version).toBe('3')
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

  it('ignores whitespace-only narrative blocks without hiding empty sections', async () => {
    const result = await chunker.structured({ maxChars: 100, overlapChars: 0 })
      .chunkDocument({
        namespace: 'kb',
        sourceId: 'whitespace-only-blocks',
        content: ' \n\t\n# Heading\n\n  \n',
        parts: [
          {
            id: 'page:1', kind: 'page', pageNumber: 1, content: ' \n\t\n',
            blocks: [
              { id: 'blank-1', kind: 'text', role: 'paragraph', content: ' \n\t' },
              { id: 'blank-2', kind: 'text', role: 'other', content: '\n  ' },
            ],
          },
          {
            id: 'page:2', kind: 'page', pageNumber: 2, content: '# Heading\n\n  \n',
            blocks: [
              { id: 'heading', kind: 'text', role: 'heading', content: '# Heading', headingPath: ['Heading'] },
              { id: 'blank-after-heading', kind: 'text', role: 'paragraph', content: '  \n', headingPath: ['Heading'] },
            ],
          },
        ],
      }, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual(['# Heading'])
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

  it('keeps semantic chunking on its caller-supplied segmentation boundary', async () => {
    const content = 'Alpha. Beta. Gamma.'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'semantic-boundaries', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Ignored', headingPath: ['Ignored'] },
          {
            id: 'table', kind: 'table', content: '| Ignored |', headingPath: ['Ignored'],
            columns: ['Ignored'], rows: [['Also ignored']],
          },
        ],
      }],
    }
    const segment = vi.fn(() => [
      { start: 0, end: 7, reason: 'caller-first' },
      { start: 7, end: content.length, reason: 'caller-second' },
    ])
    const strategy = chunker.semantic({ strategy: 'model', segment })
    const result = await strategy.chunkDocument(document, { chunking: { maxChars: 1, overlapChars: 0 } })

    expect(segment).toHaveBeenCalledOnce()
    expect(result.chunks.map((chunk) => chunk.content)).toEqual(['Alpha. ', 'Beta. Gamma.'])
    expect(result.chunks.map((chunk) => chunk.metadata.semanticReason)).toEqual(['caller-first', 'caller-second'])
    expect(result.chunks.every((chunk) => chunk.provenance?.blockIds === undefined)).toBe(true)
  })

  it('keeps parent-child pages, sections, and table windows structurally separate', async () => {
    const table = '| Name | Score |\n| --- | --- |\n| Ada Lovelace | 100 |'
    const content = `# Results\n\nBefore table\n\n${table}\n\nAfter table\n\n# Notes\n\nPage one notes\n\n# Results\n\nPage two results`
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'structured-parent-child', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: content.slice(0, content.indexOf('\n\n# Results', 20)),
        sourceLocation: { type: 'page', pageNumber: 1 },
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before table', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'],
            content: table, columns: ['Name', 'Score'], rows: [['Ada Lovelace', '100']],
          },
          { id: 'after', kind: 'text', role: 'paragraph', content: 'After table', headingPath: ['Results'] },
          { id: 'notes-heading', kind: 'text', role: 'heading', content: '# Notes', headingPath: ['Notes'] },
          { id: 'notes', kind: 'text', role: 'paragraph', content: 'Page one notes', headingPath: ['Notes'] },
        ],
      }, {
        id: 'page:2', kind: 'page', pageNumber: 2, content: '# Results\n\nPage two results',
        sourceLocation: { type: 'page', pageNumber: 2 },
        blocks: [
          { id: 'page-two-heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'page-two-body', kind: 'text', role: 'paragraph', content: 'Page two results', headingPath: ['Results'] },
        ],
      }],
    }
    const strategy = chunker.parentChild({
      parentMaxChars: 40, childMaxChars: 12, childOverlapChars: 3,
    })
    const result = await strategy.chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.parents?.map((parent) => parent.content)).toEqual([
      '# Results\n\nBefore table',
      `# Results\n\n${table}`,
      '# Results\n\nAfter table',
      '# Notes\n\nPage one notes',
      '# Results\n\nPage two results',
    ])
    expect(result.chunks.filter((child) => child.content.includes('| Name |')).map((child) => child.content))
      .toEqual([`# Results\n\n${table}`])
    expect(result.parents?.[1]?.content.length).toBeGreaterThan(40)
    expect(result.chunks.find((child) => child.content.includes('| Name |'))?.content.length).toBeGreaterThan(12)
    expect(result.parents?.map((parent) => parent.provenance?.pages)).toEqual([[1], [1], [1], [1], [2]])
    expect(result.parents?.[1]?.provenance).toEqual(expect.objectContaining({
      partIds: ['page:1'], blockIds: ['heading', 'scores'], pages: [1], tables: ['scores'],
      sourceLocations: [{ type: 'page', pageNumber: 1 }], confidence: 'derived',
    }))
    expect(result.chunks.find((child) => child.content.includes('| Name |'))?.provenance)
      .toEqual(result.parents?.[1]?.provenance)
  })

  it('keeps distinct same-page heading instances with the same compact path separate', async () => {
    const content = '# Results\n\nFirst body\n\n## Results\n\nSecond body'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'repeated-compact-path', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'h1', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'first', kind: 'text', role: 'paragraph', content: 'First body', headingPath: ['Results'] },
          { id: 'h2', kind: 'text', role: 'heading', content: '## Results', headingPath: ['Results'] },
          { id: 'second', kind: 'text', role: 'paragraph', content: 'Second body', headingPath: ['Results'] },
        ],
      }],
    }

    const result = await chunker.parentChild({
      parentMaxChars: 1_000, childMaxChars: 1_000, childOverlapChars: 0,
    }).chunkDocument(document, { chunking: { maxChars: 1_000, overlapChars: 0 } })

    expect(result.parents?.map((parent) => ({
      content: parent.content,
      blockIds: parent.provenance?.blockIds,
    }))).toEqual([
      { content: '# Results\n\nFirst body', blockIds: ['h1', 'first'] },
      { content: '# Results\n\nSecond body', blockIds: ['h2', 'second'] },
    ])
    expect(result.chunks.map((child) => ({
      content: child.content,
      blockIds: child.provenance?.blockIds,
    }))).toEqual([
      { content: '# Results\n\nFirst body', blockIds: ['h1', 'first'] },
      { content: '# Results\n\nSecond body', blockIds: ['h2', 'second'] },
    ])
  })

  it('keeps an oversized top-level typed table window indivisible', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'typed-table', content: 'ignored',
      parts: [{
        id: 'table:1', kind: 'table', content: 'Name | Score\nAda Lovelace | 100',
        columns: ['Name', 'Score'], rows: [['Ada Lovelace', '100']], pageNumber: 4,
      }],
    }
    const result = await chunker.parentChild({
      parentMaxChars: 10, childMaxChars: 5, childOverlapChars: 0,
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.parents).toHaveLength(1)
    expect(result.chunks).toHaveLength(1)
    expect(result.parents?.[0]?.content).toBe('Name | Score\nAda Lovelace | 100')
    expect(result.chunks[0]?.content).toBe(result.parents?.[0]?.content)
    expect(result.parents?.[0]?.content.length).toBeGreaterThan(10)
    expect(result.chunks[0]?.content.length).toBeGreaterThan(5)
    expect(result.parents?.[0]?.provenance).toEqual(expect.objectContaining({
      partIds: ['table:1'], pages: [4], tables: ['table:1'], confidence: 'derived',
    }))
    expect(result.chunks[0]?.provenance).toEqual(result.parents?.[0]?.provenance)
  })

  it('does not carry empty page provenance across media into later text parents', async () => {
    const result = await chunker.parentChild({
      parentMaxChars: 100, childMaxChars: 100, childOverlapChars: 0,
    }).chunkDocument({
      namespace: 'kb', sourceId: 'empty-page-media-text',
      parts: [
        {
          id: 'page:1', kind: 'page', pageNumber: 1, content: '',
          sourceLocation: { type: 'page', pageNumber: 1 },
          blocks: [{ id: 'empty', kind: 'text', role: 'paragraph', content: '' }],
        },
        {
          id: 'image:1', kind: 'media', modality: 'image',
          asset: {
            type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png',
            sha256: '00'.repeat(32),
          },
        },
        { id: 'text:1', kind: 'text', content: 'Ordinary text' },
      ],
    }, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.parents).toHaveLength(1)
    expect(result.parents?.[0]).toMatchObject({
      content: 'Ordinary text',
      provenance: { partIds: ['text:1'] },
    })
    expect(result.parents?.[0]?.provenance?.blockIds ?? []).not.toContain('empty')
    expect(result.parents?.[0]?.provenance?.pages ?? []).not.toContain(1)
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[0]).toMatchObject({
      content: '', media: { modality: 'image' }, provenance: { partIds: ['image:1'] },
    })
    expect(result.chunks[0]?.parent).toBeUndefined()
    expect(result.chunks[1]).toMatchObject({
      content: 'Ordinary text', parent: { parentId: result.parents?.[0]?.parentId },
    })
  })

  it('keeps every canonical page-block table window as its own parent and child', async () => {
    const content = '# Results\n\nName | Score\nAda Lovelace | 100\nGrace Hopper | 99\nKatherine Johnson | 98'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'windowed-page-table', content,
      parts: [{
        id: 'page:3', kind: 'page', pageNumber: 3,
        sourceLocation: { type: 'page', pageNumber: 3 }, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'], content: content.slice(11),
            columns: ['Name', 'Score'],
            rows: [['Ada Lovelace', '100'], ['Grace Hopper', '99'], ['Katherine Johnson', '98']],
          },
        ],
      }],
    }
    const result = await chunker.parentChild({
      parentMaxChars: 55, childMaxChars: 8, childOverlapChars: 0,
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.parents).toHaveLength(3)
    expect(result.chunks).toHaveLength(3)
    expect(result.chunks.map((child) => child.content)).toEqual(result.parents?.map((parent) => parent.content))
    result.parents?.forEach((parent, index) => {
      expect(parent.content).toContain('# Results\n\n| Name | Score |')
      expect(result.chunks[index]?.parent?.parentId).toBe(parent.parentId)
      expect(parent.provenance).toEqual(expect.objectContaining({
        partIds: ['page:3'], blockIds: ['heading', 'scores'], pages: [3], tables: ['scores'],
        sourceLocations: [{ type: 'page', pageNumber: 3 }], confidence: 'derived',
      }))
      expect(result.chunks[index]?.provenance).toEqual(parent.provenance)
    })
  })

  it('separates blockless physical pages without changing ordinary part compatibility', async () => {
    const strategy = chunker.parentChild({
      parentMaxChars: 100, childMaxChars: 7, childOverlapChars: 0,
    })
    const pages = await strategy.chunkDocument({
      namespace: 'kb', sourceId: 'blockless-pages', content: 'Alpha page\n\nBeta page',
      parts: [
        {
          id: 'page:1', kind: 'page', pageNumber: 1, content: 'Alpha page',
          sourceLocation: { type: 'page', pageNumber: 1 },
        },
        {
          id: 'page:2', kind: 'page', pageNumber: 2, content: 'Beta page',
          sourceLocation: { type: 'page', pageNumber: 2 },
        },
      ],
    }, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(pages.parents?.map((parent) => parent.content)).toEqual(['Alpha page', 'Beta page'])
    expect(pages.parents?.map((parent) => parent.provenance)).toEqual([
      expect.objectContaining({
        partIds: ['page:1'], pages: [1], sourceLocations: [{ type: 'page', pageNumber: 1 }],
      }),
      expect.objectContaining({
        partIds: ['page:2'], pages: [2], sourceLocations: [{ type: 'page', pageNumber: 2 }],
      }),
    ])
    pages.chunks.forEach((child) => {
      const parent = pages.parents?.find((candidate) => candidate.parentId === child.parent?.parentId)
      expect(child.provenance?.pages).toEqual(parent?.provenance?.pages)
      expect(child.provenance?.partIds).toEqual(parent?.provenance?.partIds)
      expect(child.provenance?.sourceLocations).toEqual(parent?.provenance?.sourceLocations)
    })

    const ordinary = await strategy.chunkDocument({
      namespace: 'kb', sourceId: 'ordinary-parts', content: 'Alpha\n\nBeta',
      parts: [
        { id: 'text:1', kind: 'text', content: 'Alpha' },
        { id: 'text:2', kind: 'text', content: 'Beta' },
      ],
    }, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(ordinary.parents?.map((parent) => parent.content)).toEqual(['Alpha\n\nBeta'])
  })
})
