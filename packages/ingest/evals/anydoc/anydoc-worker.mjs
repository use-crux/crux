import { createHash } from 'node:crypto'
import { Socket } from 'node:net'

const RESULT = new Socket({ fd: 3, readable: true, writable: true })
const CONTROL = new Socket({ fd: 4, readable: true, writable: true })
const format = process.argv[2]
const chunks = []

process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  void convert(Buffer.concat(chunks))
})

async function convert(bytes) {
  if (format === 'pdf') {
    send(failure('pdf-control', 'PDF is an explicit control and is never parsed by the Anydoc evaluation adapter.', bytes))
    return
  }

  if (format === '__synthetic_all_variants__') {
    const document = syntheticDocument()
    send(projectDocument(document, bytes, 'docx'))
    return
  }

  if (format?.startsWith('__convert_error__:')) {
    const code = format.slice('__convert_error__:'.length)
    send(failure(mapConvertError({ code }), `Synthetic Anydoc conversion error: ${code}`, bytes))
    return
  }

  let anydoc
  try {
    anydoc = await import('@firecrawl/anydoc')
  } catch (error) {
    send(backendUnavailable(error, bytes))
    return
  }

  try {
    const document = await anydoc.toDocument(bytes, format ?? undefined)
    const invalid = nativeDocumentProblem(document)
    if (invalid) {
      send(failure('invalid-result', invalid, bytes))
      return
    }
    const result = projectDocument(document, bytes, format)
    send(result)
  } catch (error) {
    send(failure(mapConvertError(error), errorMessage(error), bytes))
  }
}

/** Do not turn output the adapter cannot represent into a plausible partial document. */
function nativeDocumentProblem(document) {
  if (!document || !Array.isArray(document.blocks) || !Array.isArray(document.notes) || !Array.isArray(document.assets)) {
    return 'Anydoc returned an incomplete document payload.'
  }
  if (document.blocks.length === 0 && document.notes.length === 0) {
    return 'Anydoc returned no document blocks or notes.'
  }
  const validBlocks = (blocks) => blocks.every((block) => {
    if (!block || typeof block.kind !== 'string') return false
    if (block.kind === 'heading' || block.kind === 'paragraph') return Array.isArray(block.content)
    if (block.kind === 'codeBlock') return typeof block.text === 'string'
    if (block.kind === 'rule') return true
    if (block.kind === 'blockQuote') return Array.isArray(block.blocks) && validBlocks(block.blocks)
    if (block.kind === 'list') return block.list && Array.isArray(block.list.items) && block.list.items.every((item) => Array.isArray(item.blocks) && validBlocks(item.blocks) && listChildrenOnly(item.blocks))
    if (block.kind === 'table') return block.table?.kind === 'data' && Array.isArray(block.table.grid) && block.table.grid.every((row) => Array.isArray(row) && row.every((slot) => slot?.kind === 'covered' || slot?.kind === 'origin' && Array.isArray(slot.cell?.blocks) && validBlocks(slot.cell.blocks) && listChildrenOnly(slot.cell.blocks)))
    return false
  })
  if (!validBlocks(document.blocks) || !document.notes.every((note) => Array.isArray(note?.blocks) && validBlocks(note.blocks))) {
    return 'Anydoc returned an unknown or partially representable block shape.'
  }
  if (!document.assets.every((asset) => typeof asset?.mediaType === 'string' && typeof asset.originPart === 'string' && Buffer.isBuffer(asset.data))) {
    return 'Anydoc returned an incomplete asset payload.'
  }
  return undefined
}

/** Core list items and table cells can retain only text/list children. */
function listChildrenOnly(blocks) {
  return blocks.every((block) => block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'codeBlock' || block.kind === 'rule' || block.kind === 'list')
}

function projectDocument(document, bytes, sourceFormat) {
  const documentSha256 = sha256(bytes)
  const producer = { kind: 'parser', name: 'anydoc', version: '0.1.7', adapterVersion: '2-eval' }
  const coordinate = { kind: 'document', documentSha256 }
  let next = 0
  const id = (path) => `anydoc:${documentSha256}:${++next}:${path}`
  const textBlock = (text, role, path, details = {}) => ({
    id: id(path), kind: 'text', coordinate, headingPath: [], producer, role, text,
    inlines: details.inlines ?? [{ kind: 'text', text, coordinate, producer }],
    ...(details.level === undefined ? {} : { level: details.level }),
  })
  const inlineText = (inlines) => inlines.map((inline) => {
    if (inline.kind === 'text') return inline.text ?? ''
    if (inline.kind === 'link') return inlineText(inline.content ?? [])
    if (inline.kind === 'image') return inline.alt ? `[image:${inline.alt}]` : '[image]'
    if (inline.kind === 'anchor') return inline.anchor ? `[anchor:${inline.anchor}]` : '[anchor]'
    if (inline.kind === 'noteRef') return inline.noteId ? `[note:${inline.noteId}]` : '[note]'
    if (inline.kind === 'lineBreak') return '\n'
    return ''
  }).join('')
  const projectInlines = (inlines) => inlines.flatMap((inline) => {
    if (inline.kind === 'text') return [{ kind: 'text', text: inline.text ?? '', coordinate, producer }]
    if (inline.kind === 'link') return [{ kind: 'link', text: inlineText(inline.content ?? []), target: inline.target?.value ?? '', coordinate, producer }]
    if (inline.kind === 'image') return [{ kind: 'text', text: inline.alt ? `[image:${inline.alt}]` : '[image]', coordinate, producer }]
    if (inline.kind === 'anchor') return [{ kind: 'text', text: inline.anchor ? `[anchor:${inline.anchor}]` : '[anchor]', coordinate, producer }]
    if (inline.kind === 'noteRef') return [{ kind: 'text', text: inline.noteId ? `[note:${inline.noteId}]` : '[note]', coordinate, producer }]
    if (inline.kind === 'lineBreak') return [{ kind: 'text', text: '\n', coordinate, producer }]
    return []
  })
  const projectBlocks = (blocks, path) => blocks.flatMap((block, index) => {
    const blockPath = `${path}/block:${index + 1}`
    if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'codeBlock') {
      const text = block.kind === 'codeBlock' ? block.text ?? '' : inlineText(block.content ?? [])
      if (!text) return []
      return [textBlock(text, block.kind === 'heading' ? 'heading' : block.kind === 'codeBlock' ? 'code' : 'paragraph', blockPath, {
        level: block.kind === 'heading' ? block.level : undefined, inlines: projectInlines(block.content ?? []),
      })]
    }
    if (block.kind === 'blockQuote') {
      return projectBlocks(block.blocks ?? [], blockPath).map((child) => child.kind === 'text' ? { ...child, role: 'quote' } : child)
    }
    if (block.kind === 'list' && block.list) {
      const listId = id(blockPath)
      return [{ id: listId, kind: 'list', coordinate, headingPath: [], producer, ordered: block.list.marker !== 'bullet', items: block.list.items.map((item, itemIndex) => ({
        id: `${listId}:item:${itemIndex + 1}`, coordinate, producer, blocks: projectBlocks(item.blocks, `${blockPath}/item:${itemIndex + 1}`).filter(isListChild),
      })) }]
    }
    if (block.kind === 'table' && block.table?.kind === 'data') {
      const tableId = id(blockPath)
      const rows = block.table.grid.map((row, rowIndex) => row.map((slot, columnIndex) => {
        const value = slot.kind === 'origin' ? slot.cell : undefined
        const content = value ? projectBlocks(value.blocks, `${blockPath}/row:${rowIndex + 1}/column:${columnIndex + 1}`).filter(isListChild) : []
        return {
          id: `${tableId}:row:${rowIndex + 1}:column:${columnIndex + 1}`, coordinate, producer, row: rowIndex + 1, column: columnIndex + 1,
          rowSpan: value?.rowSpan ?? 1, columnSpan: value?.colSpan ?? 1, blocks: content,
          displayedValue: content.map((child) => child.text).join(''),
        }
      }))
      const columns = rows[0]?.map((cell) => cell.displayedValue ?? '') ?? []
      return [{ id: tableId, kind: 'table', coordinate, headingPath: [], producer, columns, headerRows: block.table.headerRows, rows }]
    }
    if (block.kind === 'rule') return [textBlock('---', 'code', blockPath)]
    return []
  })
  const blocks = [
    ...projectBlocks(document.blocks, 'document'),
    ...document.notes.flatMap((note, index) => projectBlocks(note.blocks, `note:${index + 1}`).map((block) => block.kind === 'text' ? { ...block, role: 'note' } : block)),
  ]
  const assets = document.assets.map((asset, index) => ({
    id: `anydoc:${documentSha256}:asset:${index + 1}`, mediaType: asset.mediaType, sha256: sha256(asset.data), byteLength: asset.data.byteLength,
    coordinate: { kind: 'package-part', part: asset.originPart }, producer,
  }))
  const relationships = {
    notes: document.notes.map((note) => ({ id: note.id, kind: note.kind })),
    inlines: collectInlineFacts(document.blocks, document.notes),
  }
  const core = { schemaVersion: 2, source: { documentSha256, mediaType: mediaType(sourceFormat), format: sourceFormat }, producer, metadata: { anydocRelationships: JSON.stringify(relationships) }, blocks, assets, diagnostics: [] }
  const native = {
    kind: 'anydoc-native-v1', source: { documentSha256, format: sourceFormat },
    facts: { blocks: document.blocks, notes: document.notes, assets: document.assets.map((asset) => ({ id: asset.id, mediaType: asset.mediaType, originPart: asset.originPart, byteLength: asset.data.byteLength })) },
  }
  return success(native, core, saturatedSum(bytes.byteLength, jsonBytes(document), jsonBytes(native), jsonBytes(core), assets.reduce((total, asset) => saturatedAdd(total, asset.byteLength), 0)), assets)
}

function isListChild(block) { return block.kind === 'text' || block.kind === 'list' }
function mediaType(format) { return format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream' }
function mapConvertError(error) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'invalid-result'
  switch (error.code) {
    case 'unsupported': return 'unsupported-format'
    case 'malformed':
    case 'missingPart':
    case 'io': return 'invalid-result'
    case 'encrypted': return 'encrypted'
    case 'resourceLimit': return 'expanded-too-large'
    default: return 'invalid-result'
  }
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error) }
function backendUnavailable(error, bytes) { return failure('backend-unavailable', `Unable to load @firecrawl/anydoc@0.1.7 or @firecrawl/anydoc-linux-x64-gnu@0.1.7: ${errorMessage(error)}`, bytes) }
function failure(error, diagnosis, bytes) { return success({ kind: 'anydoc-native-v1', outcome: { kind: 'failure', error, diagnosis }, facts: {} }, { outcome: { kind: 'failure', error, diagnosis } }, bytes.byteLength, []) }
function success(nativeValue, coreValue, expandedBytes, assets) {
  const diagnostics = nativeValue.outcome ? [nativeValue.outcome.diagnosis] : []
  return { kind: 'success', native: { value: nativeValue, diagnostics, assets }, core: { value: coreValue, diagnostics, assets }, expandedBytes, diagnostics: { count: diagnostics.length, byteLength: Buffer.byteLength(diagnostics.join('')) }, assets: { count: assets.length, byteLength: assets.reduce((total, asset) => total + asset.byteLength, 0) } }
}
function send(payload) {
  const body = Buffer.from(JSON.stringify(payload))
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(body.byteLength)
  RESULT.end(Buffer.concat([header, body]))
  CONTROL.once('data', (ack) => {
    if (ack.toString() === 'ACK\n') CONTROL.end('ACKED\n', () => process.exit(0))
  })
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function jsonBytes(value) { return Buffer.byteLength(JSON.stringify(value)) }
function saturatedAdd(left, right) { return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right }
function saturatedSum(...values) { return values.reduce((total, value) => saturatedAdd(total, value), 0) }

function collectInlineFacts(blocks, notes) {
  const facts = []
  const visitBlocks = (items, path) => items.forEach((block, index) => {
    const blockPath = `${path}/${index + 1}`
    if (Array.isArray(block.content)) visitInlines(block.content, blockPath)
    if (Array.isArray(block.blocks)) visitBlocks(block.blocks, blockPath)
    if (block.list) block.list.items.forEach((item, itemIndex) => visitBlocks(item.blocks, `${blockPath}/item:${itemIndex + 1}`))
    if (block.table) block.table.grid.forEach((row, rowIndex) => row.forEach((slot, columnIndex) => {
      if (slot.kind === 'origin') visitBlocks(slot.cell.blocks, `${blockPath}/cell:${rowIndex + 1}:${columnIndex + 1}`)
    }))
  })
  const visitInlines = (inlines, path) => inlines.forEach((inline, index) => {
    const inlinePath = `${path}/inline:${index + 1}`
    if (inline.kind === 'link') visitInlines(inline.content ?? [], inlinePath)
    if (inline.kind === 'image' || inline.kind === 'anchor' || inline.kind === 'noteRef' || inline.kind === 'lineBreak') facts.push({ path: inlinePath, kind: inline.kind, ...(inline.source ? { source: inline.source } : {}), ...(inline.anchor ? { anchor: inline.anchor } : {}), ...(inline.noteId ? { noteId: inline.noteId } : {}) })
  })
  visitBlocks(blocks, 'blocks')
  notes.forEach((note, index) => visitBlocks(note.blocks, `notes/${index + 1}`))
  return facts
}

/** Test-only input covering every documented Anydoc 0.1.7 block and inline kind. */
function syntheticDocument() {
  return {
    blocks: [
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'Heading' }] },
      { kind: 'paragraph', content: [
        { kind: 'text', text: 'text' }, { kind: 'lineBreak' },
        { kind: 'link', content: [{ kind: 'text', text: 'link' }], target: { kind: 'external', value: 'https://example.test' } },
        { kind: 'image', alt: 'image', source: { kind: 'asset', assetId: 0 } }, { kind: 'anchor', anchor: 'anchor' }, { kind: 'noteRef', noteId: 'note-1' },
      ] },
      { kind: 'list', list: { marker: 'bullet', start: 1, items: [{ blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'item' }] }] }] } },
      { kind: 'table', table: { kind: 'data', headerRows: 1, grid: [[{ kind: 'origin', cell: { blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'cell' }] }], colSpan: 1, rowSpan: 1 } }]] } },
      { kind: 'blockQuote', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'quote' }] }] },
      { kind: 'codeBlock', text: 'code' }, { kind: 'rule' },
    ],
    notes: [{ id: 'note-1', kind: 'footnote', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'note' }] }] }],
    assets: [{ id: 0, mediaType: 'image/png', originPart: 'word/media/image1.png', data: Buffer.from([1, 2, 3]) }],
  }
}
