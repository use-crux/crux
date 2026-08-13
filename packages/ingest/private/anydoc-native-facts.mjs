import { createHash } from 'node:crypto'

/** Parser-native evidence extraction. This intentionally shares no traversal or text helpers with the Core projector. */
export function extractAnydocNativeFacts(document, bytes, producer) {
  const documentSha256 = createHash('sha256').update(bytes).digest('hex')
  const documentCoordinate = { kind: 'document', documentSha256 }
  const facts = []
  const add = (factPath, value) => facts.push({ ...value, factPath })
  const provenance = (factPath, coordinate = documentCoordinate) => add(factPath, { kind: 'provenance', path: factPath, coordinate, producer })

  const nativeInlineText = (inlines) => {
    let value = ''
    for (const inline of inlines) {
      if (inline.kind === 'text') value += inline.text
      else if (inline.kind === 'link') value += nativeInlineText(inline.content)
      else if (inline.kind === 'lineBreak') value += '\n'
    }
    return value
  }
  const nativeBlockText = (block) => {
    if (block.kind === 'codeBlock') return block.text ? [block.text] : []
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      const text = nativeInlineText(block.content)
      return text ? [text] : []
    }
    if (block.kind === 'blockQuote') return block.blocks.flatMap(nativeBlockText)
    if (block.kind === 'list') return block.list.items.flatMap((item) => item.blocks.flatMap(nativeBlockText))
    if (block.kind === 'table') return block.table.grid.flatMap((row) => row.map((slot) => slot.kind === 'origin' ? slot.cell.blocks.flatMap(nativeBlockText).join('') : ''))
    return []
  }
  const nativeBlocksText = (blocks) => blocks.flatMap(nativeBlockText)
  const visitLinks = (inlines, path) => inlines.forEach((inline, index) => {
    if (inline.kind !== 'link') return
    const factPath = `${path}/inlines/${index + 1}`
    add(factPath, { kind: 'link', text: nativeInlineText(inline.content), target: inline.target.value })
    // Link facts use a distinct path from the parent block. Supervisor
    // DecodeResult rejects unbound non-provenance fact paths before ACK;
    // bind the inline path so the result can be acknowledged.
    provenance(factPath)
    visitLinks(inline.content, factPath)
  })
  const visit = (block, factPath, depth) => {
    add(factPath, { kind: 'block' })
    provenance(factPath)
    if (block.kind === 'heading' || block.kind === 'paragraph') add(factPath, { kind: 'block-text', text: nativeInlineText(block.content) })
    if (block.kind === 'codeBlock') add(factPath, { kind: 'block-text', text: block.text })
    if (block.kind === 'rule') add(factPath, { kind: 'block-text', text: '---' })
    if (block.kind === 'heading') add(factPath, { kind: 'heading', level: block.level, text: nativeInlineText(block.content) })
    if (block.kind === 'paragraph' || block.kind === 'heading') visitLinks(block.content, factPath)
    if (block.kind === 'list') {
      add(factPath, { kind: 'list', ordered: block.list.marker !== 'bullet', depth, text: nativeBlocksText(block.list.items.flatMap((item) => item.blocks)) })
      block.list.items.forEach((item, itemIndex) => item.blocks.forEach((child, childIndex) => visit(child, `${factPath}/items/${itemIndex + 1}/blocks/${childIndex + 1}`, depth + (child.kind === 'list' ? 1 : 0))))
    }
    if (block.kind === 'table') {
      const rows = block.table.grid.map((row) => row.map((slot) => slot.kind === 'origin' ? slot.cell.blocks.flatMap(nativeBlockText).join('') : ''))
      add(factPath, { kind: 'table', columns: block.table.headerRows > 0 ? rows[0] ?? [] : [], rows })
      block.table.grid.forEach((row, rowIndex) => row.forEach((slot, columnIndex) => {
        const cellPath = `${factPath}/rows/${rowIndex + 1}/columns/${columnIndex + 1}`
        provenance(cellPath)
        if (slot.kind === 'origin') {
          slot.cell.blocks.forEach((child, childIndex) => visit(child, `${cellPath}/blocks/${childIndex + 1}`, depth))
        }
      }))
    }
    if (block.kind === 'blockQuote') block.blocks.forEach((child, index) => visit(child, `${factPath}/blocks/${index + 1}`, depth))
  }

  add('document', { kind: 'ordered-text', text: nativeBlocksText(document.blocks) })
  add('document', { kind: 'notes', text: document.notes.flatMap((note) => nativeBlocksText(note.blocks)) })
  add('document', { kind: 'asset-count', count: document.assets.length })
  add('document', { kind: 'block-count', count: countNativeBlocks(document.blocks) })
  add('document', { kind: 'coordinate-kinds', kinds: document.assets.length ? ['document', 'package-part'] : ['document'] })
  add('document', { kind: 'no-parser-downgrade' })
  provenance('document')
  document.blocks.forEach((block, index) => visit(block, `blocks/${index + 1}`, 1))
  document.notes.forEach((note, noteIndex) => note.blocks.forEach((block, blockIndex) => {
    const factPath = `notes/${noteIndex + 1}/blocks/${blockIndex + 1}`
    add(factPath, { kind: 'notes', text: nativeBlockText(block) })
    visit(block, factPath, 1)
  }))
  document.assets.forEach((asset, index) => provenance(`assets/${index + 1}`, { kind: 'package-part', part: asset.originPart }))
  return facts
}

function countNativeBlocks(blocks) {
  return blocks.reduce((count, block) => count
    + 1
    + (block.kind === 'blockQuote' ? countNativeBlocks(block.blocks) : 0)
    + (block.kind === 'list' ? block.list.items.reduce((sum, item) => sum + countNativeBlocks(item.blocks), 0) : 0)
    + (block.kind === 'table' ? block.table.grid.reduce((sum, row) => sum + row.reduce((cellSum, slot) => cellSum + (slot.kind === 'origin' ? countNativeBlocks(slot.cell.blocks) : 0), 0), 0) : 0), 0)
}
