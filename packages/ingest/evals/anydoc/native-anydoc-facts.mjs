import { createHash } from 'node:crypto'

/** Eval-only extractor for the bounded @firecrawl/anydoc 0.1.7 Document model. */
export function extractAnydocNativeFacts(document, bytes, producer) {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const coordinate = { kind: 'document', documentSha256: hash }
  const facts = []
  const add = (factPath, value) => facts.push({ ...value, factPath })
  const provenance = (path, at = coordinate) => add(path, { kind: 'provenance', path, coordinate: at, producer })
  const inlineText = (items = []) => items.map((item) => item.kind === 'text' ? item.text ?? '' : item.kind === 'link' ? inlineText(item.content) : item.kind === 'lineBreak' ? '\n' : '').join('')
  const blockText = (block) => block.kind === 'codeBlock' ? block.text ?? ''
    : block.kind === 'heading' || block.kind === 'paragraph' ? inlineText(block.content)
      : block.kind === 'list' ? block.list.items.flatMap((item) => item.blocks.map(blockText)).filter(Boolean)
        : block.kind === 'table' ? block.table.grid.flatMap((row) => row.map((slot) => slot.kind === 'origin' ? slot.cell.blocks.map(blockText).flat().join('') : ''))
          : block.blocks?.map(blockText).flat() ?? []
  const flattened = (blocks) => blocks.flatMap((block) => {
    const value = blockText(block)
    return Array.isArray(value) ? value : value ? [value] : []
  })
  const visit = (block, path) => {
    provenance(path)
    if (block.kind === 'heading') add(path, { kind: 'heading', level: block.level, text: inlineText(block.content) })
    if (block.kind === 'paragraph' || block.kind === 'heading') block.content.filter((item) => item.kind === 'link').forEach((item) => add(path, { kind: 'link', text: inlineText(item.content), target: item.target?.value ?? '' }))
    if (block.kind === 'list') {
      add(path, { kind: 'list', ordered: block.list.marker !== 'bullet', depth: path.split('/').filter((part) => part === 'items').length + 1, text: flattened(block.list.items.flatMap((item) => item.blocks)) })
      block.list.items.forEach((item, itemIndex) => item.blocks.filter(representable).forEach((child, childIndex) => visit(child, `${path}/items/${itemIndex + 1}/blocks/${childIndex + 1}`)))
    }
    if (block.kind === 'table') add(path, { kind: 'table', columns: block.table.headerRows > 0 ? block.table.grid[0]?.map(cellText) ?? [] : [], rows: block.table.grid.map((row) => row.map(cellText)) })
  }
  add('document', { kind: 'ordered-text', text: flattened(document.blocks) })
  add('document', { kind: 'notes', text: document.notes.flatMap((note) => flattened(note.blocks)) })
  add('document', { kind: 'asset-count', count: document.assets.length })
  add('document', { kind: 'coordinate-kinds', kinds: document.assets.length ? ['document', 'package-part'] : ['document'] })
  add('document', { kind: 'no-parser-downgrade' })
  provenance('document')
  document.blocks.filter(representable).forEach((block, index) => visit(block, `blocks/${index + 1}`))
  document.notes.forEach((note, noteIndex) => note.blocks.filter(representable).forEach((block, index) => {
    const path = `blocks/${document.blocks.filter(representable).length + noteIndex + index + 1}`
    add(path, { kind: 'notes', text: [blockText(block)] })
    provenance(path)
  }))
  document.assets.forEach((asset, index) => provenance(`assets/${index + 1}`, { kind: 'package-part', part: asset.originPart }))
  return facts
}

function representable(block) { return ['heading', 'paragraph', 'codeBlock', 'rule', 'blockQuote', 'list', 'table'].includes(block.kind) }
function cellText(slot) { return slot.kind === 'origin' ? slot.cell.blocks.map((block) => typeof block.text === 'string' ? block.text : (block.content ?? []).map((item) => item.text ?? '').join('')).join('') : '' }
