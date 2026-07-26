import { describe, expect, it } from 'vitest'
import type {
  PromptTextDecorationFixture,
  Utf16Range,
} from './contracts.js'
import { mapPromptTextDecorationRanges } from './mapping.js'

describe('mapPromptTextDecorationRanges', () => {
  it('maps every role without crossing TypeScript or interpolation barriers', () => {
    const sourceLines = [
      'const prompt = md`# Héllo **team**',
      '> 👋 *Welcome* ${name}',
      '- Read [guide](https://example.com) and `code`',
      '`',
    ] as const
    const fixture = {
      kind: 'prompt-text-decoration-fixture',
      protocolVersion: 1,
      units: 'utf-16',
      document: {
        uri: 'file:///writer.ts',
        version: 7,
        text: sourceLines.join('\r\n'),
      },
      decorations: [
        decoration('heading', 0, 20, 25),
        decoration('strong', 0, 28, 32),
        decoration('blockquote', 1, 0, 1),
        decoration('emphasis', 1, 6, 13),
        decoration('list', 2, 0, 1),
        decoration('link', 2, 8, 13),
        decoration('code', 2, 41, 45),
      ],
    } satisfies PromptTextDecorationFixture

    const mapped = mapPromptTextDecorationRanges(fixture)

    expect(Object.fromEntries(
      Object.entries(mapped).map(([role, ranges]) => [
        role,
        ranges.map((range) => textAtRange(sourceLines, range)),
      ]),
    )).toEqual({
      heading: ['Héllo'],
      link: ['guide'],
      code: ['code'],
      emphasis: ['Welcome'],
      strong: ['team'],
      list: ['-'],
      blockquote: ['>'],
    })

    const protectedRanges = [
      range(0, 15, 17), // tag
      range(0, 17, 18), // template opening backtick
      range(1, 15, 22), // ${, expression, and }
      range(2, 40, 41), // inline-code opening backtick
      range(2, 45, 46), // inline-code closing backtick
      range(3, 0, 1), // template closing backtick
    ]
    for (const ranges of Object.values(mapped)) {
      for (const decorationRange of ranges) {
        expect(protectedRanges.some((barrier) => intersects(decorationRange, barrier))).toBe(false)
      }
    }
  })
})

function decoration(
  role: PromptTextDecorationFixture['decorations'][number]['role'],
  line: number,
  start: number,
  end: number,
): PromptTextDecorationFixture['decorations'][number] {
  return { role, range: range(line, start, end) }
}

function range(line: number, start: number, end: number): Utf16Range {
  return {
    start: { line, character: start },
    end: { line, character: end },
  }
}

function textAtRange(lines: readonly string[], value: Utf16Range): string {
  expect(value.start.line).toBe(value.end.line)
  return lines[value.start.line]?.slice(value.start.character, value.end.character) ?? ''
}

function intersects(left: Utf16Range, right: Utf16Range): boolean {
  if (left.start.line !== right.start.line || left.end.line !== right.end.line) return false
  return left.start.character < right.end.character
    && right.start.character < left.end.character
}
