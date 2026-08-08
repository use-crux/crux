import { expect, it } from 'vitest'
import type { IngestedDocument, ParserIdentity } from '@use-crux/core/indexing'
import { expectedFactsForFixture, validateExpectedFacts } from './expected-facts'
import { fixtureManifests } from './fixture-manifest'
import {
  assertCoreProjectionFacts,
  assertParserNativeFacts,
  type ExpectedFactManifest,
} from './structural-assertions'

const producer: ParserIdentity = { kind: 'parser', name: 'anydoc', version: 'test', adapterVersion: '2' }
const coordinate = { kind: 'document', documentSha256: 'a'.repeat(64) } as const

const document: IngestedDocument = {
  schemaVersion: 2,
  source: { documentSha256: 'a'.repeat(64), mediaType: 'application/test', format: 'pptx' },
  producer,
  metadata: { title: 'Fixture' },
  assets: [{ id: 'image', mediaType: 'image/png', sha256: 'b'.repeat(64), byteLength: 1, coordinate, producer }],
  diagnostics: [{ code: 'parser-downgrade', severity: 'warning', trigger: 'invalid-result', from: 'anydoc', to: 'mammoth', producer }],
  blocks: [
    {
      id: 'slide-1', kind: 'slide', slide: 1, coordinate: { kind: 'slide', slide: 1 }, headingPath: [], producer,
      notes: [{ id: 'note-1', kind: 'text', role: 'note', text: 'Owner note', coordinate, headingPath: [], producer, inlines: [] }],
      blocks: [
        { id: 'heading', kind: 'text', role: 'heading', level: 1, text: 'Slide One', coordinate, headingPath: [], producer, inlines: [] },
        {
          id: 'table', kind: 'table', coordinate, headingPath: [], producer, columns: ['Plan', 'Status'], headerRows: 1,
          rows: [[
            { id: 'cell-1', row: 1, column: 1, rowSpan: 1, columnSpan: 1, coordinate, producer, displayedValue: 'Pro', blocks: [] },
            { id: 'cell-2', row: 1, column: 2, rowSpan: 1, columnSpan: 1, coordinate, producer, displayedValue: 'Ready', blocks: [] },
          ]],
        },
      ],
    },
    {
      id: 'sheet', kind: 'sheet', sheet: 'Pricing', index: 0, range: 'A1:B2', coordinate: { kind: 'sheet-range', sheet: 'Pricing', range: 'A1:B2' }, headingPath: [], producer,
      blocks: [{
        id: 'sheet-table', kind: 'table', coordinate, headingPath: [], producer, columns: ['Plan', 'Price'], headerRows: 1,
        rows: [[
          { id: 'a1', row: 1, column: 1, rowSpan: 1, columnSpan: 1, coordinate: { kind: 'sheet-range', sheet: 'Pricing', range: 'A1' }, producer, displayedValue: 'Pro', blocks: [] },
          { id: 'b1', row: 1, column: 2, rowSpan: 1, columnSpan: 1, coordinate: { kind: 'sheet-range', sheet: 'Pricing', range: 'B1' }, producer, displayedValue: '24', formula: 'B2*1.2', mergeRange: 'B1:C1', blocks: [] },
        ]],
      }],
    },
  ],
}

it('asserts typed presentation and spreadsheet facts through both schema-2 entrypoints', () => {
  const expected: ExpectedFactManifest = {
    fixtureId: 'test', expectedOutcome: { kind: 'success' }, assertions: [
      { id: 'slides', role: 'required', kind: 'slide-order', slides: [1] },
      { id: 'slide-boundary', role: 'required', kind: 'slide-boundary', slide: 1, text: ['Slide One'] },
      { id: 'slide-text', role: 'required', kind: 'ordered-text', text: ['Slide One'] },
      { id: 'notes', role: 'required', kind: 'notes', text: ['Owner note'] },
      { id: 'assets', role: 'required', kind: 'asset-count', count: 1 },
      { id: 'sheets', role: 'required', kind: 'sheet-order', sheets: ['Pricing'] },
      { id: 'range', role: 'required', kind: 'sheet-range', sheet: 'Pricing', range: 'A1:B2' },
      { id: 'cell', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'B1', displayedValue: '24', formula: 'B2*1.2', mergeRange: 'B1:C1' },
      { id: 'downgrade', role: 'informational', kind: 'parser-downgrade', from: 'anydoc', to: 'mammoth' },
    ],
  }

  const coreResult = assertCoreProjectionFacts(expected, document)
  expect(coreResult.assertions.filter((assertion) => !assertion.passed && assertion.role === 'required')).toEqual([])
  expect(coreResult).toMatchObject({ passed: true, admitted: true })
  expect(assertParserNativeFacts(expected, { document })).toMatchObject({ passed: true, admitted: true })
})

it('fails closed for missing or hostile fixtures and bounds assertion evidence', () => {
  const expected: ExpectedFactManifest = {
    fixtureId: 'hostile', expectedOutcome: { kind: 'failure', error: 'invalid-result' }, assertions: [],
  }
  const result = assertParserNativeFacts(expected, { outcome: { kind: 'failure', error: 'worker-crash' } })

  expect(result).toMatchObject({ passed: false, admitted: false })
  expect(result.assertions[0]).toMatchObject({ id: 'outcome', passed: false, role: 'required' })
  expect(JSON.stringify(result.assertions[0].actual).length).toBeLessThan(500)
})

it('has typed expected facts for every available, hostile, and unavailable corpus fixture', () => {
  expect(validateExpectedFacts(fixtureManifests)).toEqual([])
  const missing = expectedFactsForFixture(fixtureManifests.find((fixture) => fixture.id === 'docm-macro-v1')!)
  expect(missing.expectedOutcome).toEqual({ kind: 'missing' })
  expect(assertParserNativeFacts(missing, { outcome: { kind: 'missing' } })).toMatchObject({ passed: true, admitted: false })
  expect(expectedFactsForFixture(fixtureManifests.find((fixture) => fixture.id === 'mislabeled-v1')!).expectedOutcome).toEqual({ kind: 'failure', error: 'invalid-result' })
})
