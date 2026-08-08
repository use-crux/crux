import { createHash } from 'node:crypto'

const PRODUCER = Object.freeze({ kind: 'parser', name: 'anydoc', version: '0.1.7', adapterVersion: '2-admission' })
const BLOCK_KINDS = new Set(['heading', 'paragraph', 'codeBlock', 'rule', 'blockQuote', 'list', 'table'])
const INLINE_KINDS = new Set(['text', 'link', 'image', 'anchor', 'noteRef', 'lineBreak'])

/** Validate and project the closed Anydoc 0.1.7 model without invoking native code. */
export function admitAnydocDocument(document, bytes, sourceFormat, limits = {}) {
  const budget = traversalBudget(limits)
  const state = { nodes: 0, keys: 0, depth: 0, budget }
  validateDocument(document, state)

  const documentSha256 = sha256(bytes)
  const coordinate = { kind: 'document', documentSha256 }
  const facts = extractAnydocNativeFacts(document, bytes, PRODUCER)
  const relationships = collectRelationships(document)
  let sequence = 0
  const id = (path) => `anydoc:${documentSha256}:${++sequence}:${path}`
  const blocks = [
    ...projectBlocks(document.blocks, 'document', coordinate, id),
    ...document.notes.flatMap((note, index) => projectBlocks(note.blocks, `note:${index + 1}`, coordinate, id)
      .map((block) => block.kind === 'text' ? { ...block, role: 'note' } : block)),
  ]
  const assets = document.assets.map((asset, index) => ({
    id: `anydoc:${documentSha256}:asset:${index + 1}`,
    mediaType: asset.mediaType,
    sha256: sha256(asset.data),
    byteLength: asset.data.byteLength,
    coordinate: { kind: 'package-part', part: asset.originPart },
    producer: PRODUCER,
  }))
  const core = {
    schemaVersion: 2,
    source: { documentSha256, mediaType: mediaType(sourceFormat), format: sourceFormat },
    producer: PRODUCER,
    metadata: { anydocRelationships: JSON.stringify(relationships) },
    blocks,
    assets,
    diagnostics: [],
  }
  const native = {
    kind: 'anydoc-native-v2',
    source: { documentSha256, format: sourceFormat },
    observed: {
      blockCount: countBlocks(document.blocks),
      noteCount: document.notes.length,
      assets: document.assets.map(({ id, mediaType, originPart, data }) => ({ id, mediaType, originPart, byteLength: data.byteLength })),
    },
    facts,
  }
  return { native, core, relationships }
}

export function extractAnydocNativeFacts(document, bytes, producer = PRODUCER) {
  const hash = sha256(bytes)
  const coordinate = { kind: 'document', documentSha256: hash }
  const facts = []
  const add = (factPath, value) => facts.push({ ...value, factPath })
  const provenance = (path, at = coordinate) => add(path, { kind: 'provenance', path, coordinate: at, producer })
  const flattened = (blocks) => blocks.flatMap((block) => flattenText(block))
  const visit = (block, path, depth) => {
    provenance(path)
    if (block.kind === 'heading') add(path, { kind: 'heading', level: block.level, text: inlineText(block.content) })
    if (block.kind === 'paragraph' || block.kind === 'heading') visitLinks(block.content, path, add)
    if (block.kind === 'list') {
      add(path, { kind: 'list', ordered: block.list.marker !== 'bullet', depth, text: flattened(block.list.items.flatMap((item) => item.blocks)) })
      block.list.items.forEach((item, itemIndex) => item.blocks.forEach((child, childIndex) => visit(child, `${path}/items/${itemIndex + 1}/blocks/${childIndex + 1}`, depth + (child.kind === 'list' ? 1 : 0))))
    }
    if (block.kind === 'table') add(path, { kind: 'table', columns: block.table.headerRows > 0 ? block.table.grid[0]?.map(cellText) ?? [] : [], rows: block.table.grid.map((row) => row.map(cellText)) })
    if (block.kind === 'blockQuote') block.blocks.forEach((child, index) => visit(child, `${path}/blocks/${index + 1}`, depth))
  }
  add('document', { kind: 'ordered-text', text: flattened(document.blocks) })
  add('document', { kind: 'notes', text: document.notes.flatMap((note) => flattened(note.blocks)) })
  add('document', { kind: 'asset-count', count: document.assets.length })
  add('document', { kind: 'coordinate-kinds', kinds: document.assets.length ? ['document', 'package-part'] : ['document'] })
  add('document', { kind: 'no-parser-downgrade' })
  provenance('document')
  document.blocks.forEach((block, index) => visit(block, `blocks/${index + 1}`, 1))
  document.notes.forEach((note, noteIndex) => note.blocks.forEach((block, index) => {
    const path = `notes/${noteIndex + 1}/blocks/${index + 1}`
    add(path, { kind: 'notes', text: flattenText(block) })
    provenance(path)
  }))
  document.assets.forEach((asset, index) => provenance(`assets/${index + 1}`, { kind: 'package-part', part: asset.originPart }))
  return facts
}

function validateDocument(value, state) {
  requireRecord(value, ['blocks', 'notes', 'assets'], state)
  requireArray(value.blocks, state)
  requireArray(value.notes, state)
  requireArray(value.assets, state)
  value.blocks.forEach((block) => validateBlock(block, state, 1))
  value.notes.forEach((note) => {
    requireRecord(note, ['id', 'kind', 'blocks'], state)
    requireString(note.id); requireString(note.kind); requireArray(note.blocks, state)
    note.blocks.forEach((block) => validateBlock(block, state, 2))
  })
  value.assets.forEach((asset) => {
    requireRecord(asset, ['id', 'mediaType', 'originPart', 'data'], state)
    if (!Number.isSafeInteger(asset.id) || asset.id < 0) invalid()
    requireString(asset.mediaType); requireString(asset.originPart)
    if (!Buffer.isBuffer(asset.data)) invalid()
  })
  if (value.blocks.length === 0 && value.notes.length === 0) invalid()
}

function validateBlock(block, state, depth) {
  enter(state, depth)
  if (!block || typeof block.kind !== 'string' || !BLOCK_KINDS.has(block.kind)) invalid()
  if (block.kind === 'heading') {
    requireRecord(block, ['kind', 'level', 'content'], state)
    if (!Number.isSafeInteger(block.level) || block.level < 1 || block.level > 6) invalid()
    validateInlines(block.content, state, depth + 1)
  } else if (block.kind === 'paragraph') {
    requireRecord(block, ['kind', 'content'], state); validateInlines(block.content, state, depth + 1)
  } else if (block.kind === 'codeBlock') {
    requireRecord(block, ['kind', 'text'], state); requireString(block.text)
  } else if (block.kind === 'rule') {
    requireRecord(block, ['kind'], state)
  } else if (block.kind === 'blockQuote') {
    requireRecord(block, ['kind', 'blocks'], state); requireArray(block.blocks, state); block.blocks.forEach((child) => validateBlock(child, state, depth + 1))
  } else if (block.kind === 'list') {
    requireRecord(block, ['kind', 'list'], state); requireRecord(block.list, ['marker', 'start', 'items'], state)
    if (!['bullet', 'ordered'].includes(block.list.marker) || !Number.isSafeInteger(block.list.start)) invalid()
    requireArray(block.list.items, state)
    block.list.items.forEach((item) => { requireRecord(item, ['blocks'], state); requireArray(item.blocks, state); item.blocks.forEach((child) => validateBlock(child, state, depth + 1)) })
  } else {
    requireRecord(block, ['kind', 'table'], state); requireRecord(block.table, ['kind', 'headerRows', 'grid'], state)
    if (block.table.kind !== 'data' || !Number.isSafeInteger(block.table.headerRows) || block.table.headerRows < 0) invalid()
    requireArray(block.table.grid, state)
    block.table.grid.forEach((row) => { requireArray(row, state); row.forEach((slot) => validateSlot(slot, state, depth + 1)) })
  }
}

function validateSlot(slot, state, depth) {
  if (!slot || slot.kind === 'covered') { requireRecord(slot, ['kind'], state); return }
  requireRecord(slot, ['kind', 'cell'], state)
  if (slot.kind !== 'origin') invalid()
  requireRecord(slot.cell, ['blocks'], state, ['colSpan', 'rowSpan'])
  if (slot.cell.colSpan !== undefined && (!Number.isSafeInteger(slot.cell.colSpan) || slot.cell.colSpan < 1) || slot.cell.rowSpan !== undefined && (!Number.isSafeInteger(slot.cell.rowSpan) || slot.cell.rowSpan < 1)) invalid()
  requireArray(slot.cell.blocks, state); slot.cell.blocks.forEach((block) => validateBlock(block, state, depth + 1))
}

function validateInlines(values, state, depth) {
  requireArray(values, state)
  values.forEach((inline) => {
    enter(state, depth)
    if (!inline || typeof inline.kind !== 'string' || !INLINE_KINDS.has(inline.kind)) invalid()
    if (inline.kind === 'text') {
      requireRecord(inline, ['kind', 'text'], state, ['style']); requireString(inline.text)
      if (inline.style !== undefined) {
        requireRecord(inline.style, ['bold', 'italic', 'strike', 'code'], state)
        if (Object.values(inline.style).some((value) => typeof value !== 'boolean')) invalid()
      }
    }
    else if (inline.kind === 'lineBreak') requireRecord(inline, ['kind'], state)
    else if (inline.kind === 'anchor') { requireRecord(inline, ['kind', 'anchor'], state); requireString(inline.anchor) }
    else if (inline.kind === 'noteRef') { requireRecord(inline, ['kind', 'noteId'], state); requireString(inline.noteId) }
    else if (inline.kind === 'image') { requireRecord(inline, ['kind', 'alt', 'source'], state); requireString(inline.alt); validateSource(inline.source, state) }
    else { requireRecord(inline, ['kind', 'content', 'target'], state); validateInlines(inline.content, state, depth + 1); validateTarget(inline.target, state) }
  })
}

function validateSource(source, state) { requireRecord(source, ['kind', 'assetId'], state); if (source.kind !== 'asset' || !Number.isSafeInteger(source.assetId) || source.assetId < 0) invalid() }
function validateTarget(target, state) { requireRecord(target, ['kind', 'value'], state); if (!['external', 'internal'].includes(target.kind)) invalid(); requireString(target.value) }
function requireRecord(value, keys, state, optional = []) { state.nodes++; check(state); const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []; if (!value || typeof value !== 'object' || Array.isArray(value) || !keys.every((key) => Object.hasOwn(value, key)) || actual.some((key) => !keys.includes(key) && !optional.includes(key))) invalid(); state.keys += actual.length; check(state) }
function requireArray(value, state) { if (!Array.isArray(value)) invalid(); state.nodes += value.length; check(state) }
function requireString(value) { if (typeof value !== 'string') invalid() }
function enter(state, depth) { state.nodes++; state.depth = Math.max(state.depth, depth); check(state) }
function check(state) { if (state.nodes > state.budget.nodes || state.keys > state.budget.keys || state.depth > 128) throw new AnydocAdmissionError('expanded-too-large') }
function invalid() { throw new AnydocAdmissionError('invalid-result') }
function traversalBudget(limits) { const bytes = Math.min(limits.expandedBytes ?? 256 << 20, limits.resultBytes ?? 8 << 20); return { nodes: Math.max(1, Math.floor(bytes / 2)), keys: Math.max(1, Math.floor(bytes / 4)) } }

function projectBlocks(blocks, path, coordinate, id) {
  return blocks.flatMap((block, index) => {
    const blockPath = `${path}/block:${index + 1}`
    if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'codeBlock') {
      const text = block.kind === 'codeBlock' ? block.text : inlineText(block.content)
      if (!text) return []
      return [{ id: id(blockPath), kind: 'text', coordinate, headingPath: [], producer: PRODUCER, role: block.kind === 'heading' ? 'heading' : block.kind === 'codeBlock' ? 'code' : 'paragraph', text, inlines: block.kind === 'codeBlock' ? [{ kind: 'text', text, coordinate, producer: PRODUCER }] : projectInlines(block.content, coordinate), ...(block.kind === 'heading' ? { level: block.level } : {}) }]
    }
    if (block.kind === 'blockQuote') return projectBlocks(block.blocks, blockPath, coordinate, id).map((child) => child.kind === 'text' ? { ...child, role: 'quote' } : child)
    if (block.kind === 'list') {
      const listId = id(blockPath)
      return [{ id: listId, kind: 'list', coordinate, headingPath: [], producer: PRODUCER, ordered: block.list.marker !== 'bullet', items: block.list.items.map((item, itemIndex) => ({ id: `${listId}:item:${itemIndex + 1}`, coordinate, producer: PRODUCER, blocks: projectBlocks(item.blocks, `${blockPath}/item:${itemIndex + 1}`, coordinate, id).filter(isListChild) })) }]
    }
    if (block.kind === 'table') {
      const tableId = id(blockPath)
      const rows = block.table.grid.map((row, rowIndex) => row.map((slot, columnIndex) => {
        const cell = slot.kind === 'origin' ? slot.cell : undefined
        const contents = cell ? projectBlocks(cell.blocks, `${blockPath}/row:${rowIndex + 1}/column:${columnIndex + 1}`, coordinate, id).filter(isListChild) : []
        return { id: `${tableId}:row:${rowIndex + 1}:column:${columnIndex + 1}`, coordinate, producer: PRODUCER, row: rowIndex + 1, column: columnIndex + 1, rowSpan: cell?.rowSpan ?? 1, columnSpan: cell?.colSpan ?? 1, blocks: contents, displayedValue: contents.map((child) => child.text ?? '').join('') }
      }))
      return [{ id: tableId, kind: 'table', coordinate, headingPath: [], producer: PRODUCER, columns: block.table.headerRows > 0 ? rows[0]?.map((cell) => cell.displayedValue) ?? [] : [], headerRows: block.table.headerRows, rows }]
    }
    if (block.kind === 'rule') return [{ id: id(blockPath), kind: 'text', coordinate, headingPath: [], producer: PRODUCER, role: 'code', text: '---', inlines: [{ kind: 'text', text: '---', coordinate, producer: PRODUCER }] }]
    return []
  })
}

function projectInlines(inlines, coordinate) { return inlines.flatMap((inline) => inline.kind === 'text' ? [{ kind: 'text', text: inline.text, coordinate, producer: PRODUCER }] : inline.kind === 'link' ? [{ kind: 'link', text: inlineText(inline.content), target: inline.target.value, coordinate, producer: PRODUCER }] : inline.kind === 'lineBreak' ? [{ kind: 'text', text: '\n', coordinate, producer: PRODUCER }] : [{ kind: 'text', text: inline.kind === 'image' ? `[image:${inline.alt}]` : inline.kind === 'anchor' ? `[anchor:${inline.anchor}]` : `[note:${inline.noteId}]`, coordinate, producer: PRODUCER }]) }
function collectRelationships(document) { const values = []; const walkInlines = (inlines, path) => inlines.forEach((inline, index) => { const at = `${path}/inline:${index + 1}`; if (inline.kind === 'link') { values.push({ path: at, kind: inline.kind, target: inline.target }); walkInlines(inline.content, at) } else if (!['text'].includes(inline.kind)) values.push({ path: at, kind: inline.kind, ...(inline.source ? { source: inline.source } : {}), ...(inline.anchor ? { anchor: inline.anchor } : {}), ...(inline.noteId ? { noteId: inline.noteId } : {}) }) }); const walk = (blocks, path) => blocks.forEach((block, index) => { const at = `${path}/${index + 1}`; if (block.content) walkInlines(block.content, at); if (block.blocks) walk(block.blocks, at); if (block.list) block.list.items.forEach((item, itemIndex) => walk(item.blocks, `${at}/item:${itemIndex + 1}`)); if (block.table) block.table.grid.forEach((row, rowIndex) => row.forEach((slot, columnIndex) => { if (slot.kind === 'origin') walk(slot.cell.blocks, `${at}/cell:${rowIndex + 1}:${columnIndex + 1}`) })) }); walk(document.blocks, 'blocks'); document.notes.forEach((note, index) => walk(note.blocks, `notes/${index + 1}`)); return { notes: document.notes.map(({ id, kind }) => ({ id, kind })), inlines: values } }
function visitLinks(inlines, path, add) { inlines.forEach((inline, index) => { if (inline.kind === 'link') { add(`${path}/inlines/${index + 1}`, { kind: 'link', text: inlineText(inline.content), target: inline.target.value }); visitLinks(inline.content, `${path}/inlines/${index + 1}`, add) } }) }
function inlineText(items) { return items.map((item) => item.kind === 'text' ? item.text : item.kind === 'link' ? inlineText(item.content) : item.kind === 'lineBreak' ? '\n' : '').join('') }
function flattenText(block) { if (block.kind === 'codeBlock') return block.text ? [block.text] : []; if (block.kind === 'heading' || block.kind === 'paragraph') { const text = inlineText(block.content); return text ? [text] : [] } if (block.kind === 'list') return block.list.items.flatMap((item) => item.blocks.flatMap(flattenText)); if (block.kind === 'table') return block.table.grid.flatMap((row) => row.map(cellText)); if (block.kind === 'blockQuote') return block.blocks.flatMap(flattenText); return [] }
function cellText(slot) { return slot.kind === 'origin' ? slot.cell.blocks.flatMap(flattenText).join('') : '' }
function isListChild(block) { return block.kind === 'text' || block.kind === 'list' }
function countBlocks(blocks) { return blocks.reduce((count, block) => count + 1 + (block.blocks ? countBlocks(block.blocks) : 0) + (block.list ? block.list.items.reduce((sum, item) => sum + countBlocks(item.blocks), 0) : 0) + (block.table ? block.table.grid.reduce((sum, row) => sum + row.reduce((cells, slot) => cells + (slot.kind === 'origin' ? countBlocks(slot.cell.blocks) : 0), 0), 0) : 0), 0) }
function mediaType(format) { return format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream' }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

export class AnydocAdmissionError extends Error {
  constructor(code) { super(code === 'expanded-too-large' ? 'Anydoc document exceeded the bounded traversal budget.' : 'Anydoc returned an unknown or partially representable document.'); this.name = 'AnydocAdmissionError'; this.code = code }
}
