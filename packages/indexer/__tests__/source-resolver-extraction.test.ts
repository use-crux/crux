import { describe, expect, it } from 'vitest'
import { extractFunctionBody } from '../source-resolver/extraction'

describe('source resolver function extraction', () => {
  it('extracts a function declaration body through its closing brace', () => {
    const source = ['export function writer() {', "  return 'draft'", '}', 'const after = true'].join('\n')

    expect(extractFunctionBody(source, 1, 0)).toEqual({
      source: ['export function writer() {', "  return 'draft'", '}'].join('\n'),
      endLine: 3,
    })
  })

  it('extracts arrow functions with nested braces and template interpolation', () => {
    const source = [
      'export const writer = () => {',
      '  const value = `{${JSON.stringify({ ok: true })}}`',
      '  return { value }',
      '}',
      'const after = true',
    ].join('\n')

    expect(extractFunctionBody(source, 1, 0)?.source).toBe(
      [
        'export const writer = () => {',
        '  const value = `{${JSON.stringify({ ok: true })}}`',
        '  return { value }',
        '}',
      ].join('\n'),
    )
  })

  it('returns expression arrow source when no block body is present', () => {
    const source = "export const writer = () => 'draft'"

    expect(extractFunctionBody(source, 1, 0)).toEqual({
      source,
      endLine: 1,
    })
  })

  it('caps extraction at the configured max line count', () => {
    const source = ['export function long() {', '  step()', '  step()', '  step()'].join('\n')

    expect(extractFunctionBody(source, 1, 0, 2)).toEqual({
      source: ['export function long() {', '  step()'].join('\n'),
      endLine: 2,
    })
  })
})
