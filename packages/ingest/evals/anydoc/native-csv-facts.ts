import { createHash } from 'node:crypto'
import { fact, provenance, type NativeFact, type NativeProducer } from './native-fact-schema'

const PRODUCER: NativeProducer = { kind: 'parser', name: 'csv-parse', version: '6.2.1', adapterVersion: '2' }

/** Extract eval evidence directly from csv-parse's row matrix. */
export function extractCsvNativeFacts(rows: readonly (readonly unknown[])[], bytes: Uint8Array): readonly NativeFact[] {
  const matrix = rows.map((row) => row.map((cell) => String(cell ?? '')))
  const hash = createHash('sha256').update(bytes).digest('hex')
  const document = { kind: 'document' as const, documentSha256: hash }
  const table = { kind: 'logical-table' as const, rowStart: 1, rowEnd: matrix.length }
  if (matrix.length === 0) {
    return [fact('document', { kind: 'ordered-text', text: [] }), fact('document', { kind: 'coordinate-kinds', kinds: [] }), fact('document', { kind: 'no-parser-downgrade' }), provenance('document', document, PRODUCER)]
  }
  return [
    fact('document', { kind: 'ordered-text', text: matrix.flat() }),
    fact('document', { kind: 'notes', text: [] }),
    fact('document', { kind: 'asset-count', count: 0 }),
    fact('document', { kind: 'coordinate-kinds', kinds: ['logical-table'] }),
    fact('document', { kind: 'no-parser-downgrade' }),
    provenance('document', document, PRODUCER),
    fact('blocks/1', { kind: 'table', columns: matrix[0] ?? [], rows: matrix }),
    fact('blocks/1', { kind: 'csv-matrix', matrix }),
    fact('blocks/1', { kind: 'logical-row-bounds', start: 1, end: matrix.length }),
    provenance('blocks/1', table, PRODUCER),
  ]
}
