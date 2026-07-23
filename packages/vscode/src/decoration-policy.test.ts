import { describe, expect, it } from 'vitest'
import {
  buildLineDecorations,
  filterAffectedVisibleUris,
  inlineDiagnosticsExtensionIds,
  resolveDecorationMode,
} from './decoration-policy.js'

describe('buildLineDecorations', () => {
  it('renders the severity glyph, code, and first message line', () => {
    expect(buildLineDecorations([{
      line: 4,
      severity: 1,
      code: 'runtime.duplicate_target_name',
      message: 'Duplicate target\r\nSecond line is omitted',
    }], 80)).toEqual([{
      line: 4,
      severity: 'error',
      text: '✖ runtime.duplicate_target_name: Duplicate target',
    }])
  })

  it('keeps the most severe diagnostic per line and the first diagnostic on ties', () => {
    expect(buildLineDecorations([
      { line: 8, severity: 2, code: 'warning.first', message: 'warning' },
      { line: 8, severity: 1, code: 'error.first', message: 'first error' },
      { line: 8, severity: 1, code: 'error.second', message: 'second error' },
      { line: 2, severity: 4, code: 'hint.only', message: 'hint' },
    ], 80)).toEqual([
      { line: 2, severity: 'hint', text: '○ hint.only: hint' },
      { line: 8, severity: 'error', text: '✖ error.first: first error +2' },
    ])
  })

  it('truncates by Unicode characters while preserving the additional-count suffix', () => {
    const [decoration] = buildLineDecorations([
      { line: 0, severity: 3, code: 'rule', message: '😀 abcdefghijklmnopqrstuvwxyz' },
      { line: 0, severity: 4, code: 'other', message: 'other' },
    ], 18)

    expect(decoration).toEqual({
      line: 0,
      severity: 'information',
      text: 'ℹ rule: 😀 abcd… +1',
    })
    expect(Array.from(decoration!.text)).toHaveLength(18)
  })
})

describe('resolveDecorationMode', () => {
  it.each([
    { mode: 'auto' as const, active: [], enabled: true },
    { mode: 'auto' as const, active: [inlineDiagnosticsExtensionIds[0]], enabled: false, detected: inlineDiagnosticsExtensionIds[0] },
    { mode: 'auto' as const, active: ['unrelated.extension'], enabled: true },
    { mode: 'on' as const, active: [...inlineDiagnosticsExtensionIds], enabled: true },
    { mode: 'off' as const, active: [], enabled: false },
  ])('$mode with $active', ({ mode, active, enabled, detected }) => {
    expect(resolveDecorationMode(mode, active)).toEqual({
      enabled,
      ...(detected === undefined ? {} : { detectedExtensionId: detected }),
    })
  })
})

describe('filterAffectedVisibleUris', () => {
  it('returns unique affected URIs in visible-editor order', () => {
    expect(filterAffectedVisibleUris(
      ['file:///b.ts', 'file:///hidden.ts', 'file:///b.ts'],
      ['file:///a.ts', 'file:///b.ts', 'file:///b.ts'],
    )).toEqual(['file:///b.ts'])
  })
})
