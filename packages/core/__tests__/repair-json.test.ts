import { describe, it, expect } from 'vitest'
import { repairJsonText } from '../src/generation/repair-json'

describe('repairJsonText()', () => {
  it('returns valid JSON unchanged', () => {
    const json = '{"name": "test", "value": 42}'
    expect(repairJsonText(json)).toBe(json)
  })

    it('strips markdown ```json fences', () => {
    const input = '```json\n{"name": "test"}\n```'
    expect(repairJsonText(input)).toBe('{"name": "test"}')
  })

    it('strips markdown ``` fences without language tag', () => {
    const input = '```\n{"arr": [1, 2, 3]}\n```'
    expect(repairJsonText(input)).toBe('{"arr": [1, 2, 3]}')
  })

    it('extracts JSON from preamble/postamble text', () => {
    const input = 'Here is the JSON output:\n{"name": "test"}\nHope this helps!'
    expect(repairJsonText(input)).toBe('{"name": "test"}')
  })

    it('extracts JSON array from surrounding text', () => {
    const input = 'The result is: [1, 2, 3] as requested.'
    expect(repairJsonText(input)).toBe('[1, 2, 3]')
  })

    it('handles nested objects when finding JSON boundaries', () => {
    const input = 'Output: {"a": {"b": {"c": 1}}} done'
    expect(repairJsonText(input)).toBe('{"a": {"b": {"c": 1}}}')
  })

    it('fixes trailing commas in objects', () => {
    const input = '{"a": 1, "b": 2,}'
    expect(repairJsonText(input)).toBe('{"a": 1, "b": 2}')
  })

    it('fixes trailing commas in arrays', () => {
    const input = '[1, 2, 3,]'
    expect(repairJsonText(input)).toBe('[1, 2, 3]')
  })

    it('handles combined issues: fences + trailing comma', () => {
    const input = '```json\n{"name": "test", "value": 42,}\n```'
    expect(repairJsonText(input)).toBe('{"name": "test", "value": 42}')
  })

    it('returns null for completely unfixable text', () => {
    expect(repairJsonText('This is just plain text')).toBeNull()
  })

    it('returns null for malformed JSON that cannot be repaired', () => {
    expect(repairJsonText('{"unclosed": ')).toBeNull()
  })

    it('handles empty string', () => {
    expect(repairJsonText('')).toBeNull()
  })

    it('preserves valid JSON arrays', () => {
    const json = '[{"id": 1}, {"id": 2}]'
    expect(repairJsonText(json)).toBe(json)
  })

    it('handles whitespace around valid JSON', () => {
    const input = '  \n  {"name": "test"}  \n  '
    expect(repairJsonText(input)).toBe('{"name": "test"}')
  })
})
