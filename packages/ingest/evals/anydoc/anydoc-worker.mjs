import { Socket } from 'node:net'
import { admitAnydocDocument, AnydocAdmissionError } from '../../private/anydoc-admission.mjs'

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
    const result = projectDocument(document, bytes, format)
    send(result)
  } catch (error) {
    send(failure(mapConvertError(error), errorMessage(error), bytes))
  }
}

function projectDocument(document, bytes, sourceFormat) {
  try {
    const { native, core } = admitAnydocDocument(document, bytes, sourceFormat)
    return success(native, core, saturatedSum(bytes.byteLength, jsonBytes(native), jsonBytes(core), core.assets.reduce((total, asset) => saturatedAdd(total, asset.byteLength), 0)), core.assets)
  } catch (error) {
    if (error instanceof AnydocAdmissionError) return failure(error.code, error.message, bytes)
    throw error
  }
}
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
function jsonBytes(value) { return Buffer.byteLength(JSON.stringify(value)) }
function saturatedAdd(left, right) { return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right }
function saturatedSum(...values) { return values.reduce((total, value) => saturatedAdd(total, value), 0) }


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
