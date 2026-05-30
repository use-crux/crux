import { describe, it, expect } from 'vitest'
import { configure } from '../configure'
import { prompt as cruxPrompt } from '../define'

function makePrompt(id: string, tags: string[] = []) {
  return cruxPrompt({ id, tags, system: `Prompt ${id}` })
}

describe('configure', () => {
  it('get() returns prompt by id', () => {
    const p = makePrompt('alpha')
    const reg = configure({ prompts: [p] })
    expect(reg.get('alpha')).toBe(p)
    reg.dispose()
  })

  it('get() throws on missing id', () => {
    const reg = configure({ prompts: [makePrompt('a')] })
    expect(() => reg.get('nonexistent')).toThrow(/prompt "nonexistent" not found/)
    reg.dispose()
  })

  it('find() returns prompt or undefined', () => {
    const p = makePrompt('beta')
    const reg = configure({ prompts: [p] })
    expect(reg.find('beta')).toBe(p)
    expect(reg.find('missing')).toBeUndefined()
    reg.dispose()
  })

  it('list() returns all prompts', () => {
    const prompts = [makePrompt('a'), makePrompt('b'), makePrompt('c')]
    const reg = configure({ prompts })
    expect(reg.list()).toHaveLength(3)
    reg.dispose()
  })

  it('byTag() filters correctly', () => {
    const p1 = makePrompt('p1', ['editing'])
    const p2 = makePrompt('p2', ['analysis'])
    const p3 = makePrompt('p3', ['editing', 'analysis'])
    const reg = configure({ prompts: [p1, p2, p3] })

    expect(reg.byTag('editing')).toEqual([p1, p3])
    expect(reg.byTag('analysis')).toEqual([p2, p3])
    expect(reg.byTag('nonexistent')).toEqual([])
    reg.dispose()
  })

  it('byTags() intersects multiple tags', () => {
    const p1 = makePrompt('p1', ['a', 'b'])
    const p2 = makePrompt('p2', ['a'])
    const p3 = makePrompt('p3', ['a', 'b', 'c'])
    const reg = configure({ prompts: [p1, p2, p3] })

    expect(reg.byTags(['a', 'b'])).toEqual([p1, p3])
    expect(reg.byTags([])).toEqual([])
    reg.dispose()
  })

  it('tags() returns all unique tags', () => {
    const reg = configure({
      prompts: [makePrompt('p1', ['a', 'b']), makePrompt('p2', ['b', 'c'])],
    })
    expect(reg.tags().sort()).toEqual(['a', 'b', 'c'])
    reg.dispose()
  })

  it('throws on missing id at creation', () => {
    const p = cruxPrompt({ system: 'no id' } as any) // id is undefined
    expect(() => configure({ prompts: [p] })).toThrow(/all prompts must have an id/)
  })

  it('throws on duplicate id at creation', () => {
    expect(() => configure({ prompts: [makePrompt('dup'), makePrompt('dup')] })).toThrow(/duplicate prompt id "dup"/)
  })
})
