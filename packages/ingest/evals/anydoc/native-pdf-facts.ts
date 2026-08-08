import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { toString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import { fact, provenance, type NativeFact, type NativeProducer } from './native-fact-schema'

const PRODUCER: NativeProducer = { kind: 'parser', name: 'pdf-inspector', version: '1.12.0', adapterVersion: '2' }
export interface PdfInspectorPage { readonly page: number; readonly markdown: string; readonly needsOcr: boolean }

/** Extract eval evidence from pdf-inspector's page/layout payload. */
export function extractPdfNativeFacts(raw: { readonly pages: readonly PdfInspectorPage[] }, bytes: Uint8Array): readonly NativeFact[] {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const facts: NativeFact[] = [
    fact('document', { kind: 'page-order', pages: raw.pages.map((page) => page.page + 1) }),
    fact('document', { kind: 'coordinate-kinds', kinds: ['page', 'page-block'] }),
    fact('document', { kind: 'asset-count', count: 0 }), fact('document', { kind: 'notes', text: [] }),
    fact('document', { kind: 'no-parser-downgrade' }),
    provenance('document', { kind: 'document', documentSha256: hash }, PRODUCER),
  ]
  const orderedText: string[] = []
  raw.pages.forEach((page, pageIndex) => {
    const pageNumber = page.page + 1
    const pagePath = `blocks/${pageIndex + 1}`
    const blocks = markdownBlocks(page.markdown)
    facts.push(provenance(pagePath, { kind: 'page', page: pageNumber }, PRODUCER))
    facts.push(fact(pagePath, { kind: 'page-content-hash', page: pageNumber, sha256: createHash('sha256').update(JSON.stringify(blocks.map((block) => block.text))).digest('hex') }))
    blocks.forEach((block, index) => {
      const path = `${pagePath}/blocks/${index + 1}`
      const coordinate = { kind: 'page-block' as const, page: pageNumber, block: index + 1, start: block.start, end: block.end }
      facts.push(fact(path, { kind: 'page-block', page: pageNumber, block: index + 1, text: block.text }), provenance(path, coordinate, PRODUCER))
      if (block.heading) facts.push(fact(path, { kind: 'heading', level: block.heading, text: block.visible }))
      if (block.table) facts.push(fact(path, { kind: 'table', columns: block.table[0] ?? [], rows: block.table }))
      orderedText.push(block.text)
    })
  })
  facts.unshift(fact('document', { kind: 'ordered-text', text: orderedText }))
  return facts
}

function markdownBlocks(markdown: string): readonly { text: string; visible: string; heading?: number; table?: readonly (readonly string[])[]; start: number; end: number }[] {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  return tree.children.flatMap((node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return []
    const raw = markdown.slice(start, end)
    if (!raw.trim()) return []
    const visible = toString(node).replace(/\s+/g, ' ').trim()
    const table = node.type === 'table' ? node.children.map((row) => row.children.map((cell) => toString(cell))) : undefined
    return [{ text: raw, visible, ...(node.type === 'heading' ? { heading: node.depth } : {}), ...(table ? { table } : {}), start, end }]
  })
}
