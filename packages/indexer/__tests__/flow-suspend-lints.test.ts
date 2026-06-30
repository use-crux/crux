import { describe, expect, it } from 'vitest'
import { createStaticExtraction, type SourceReader } from '../indexer/static/extraction/engine'
import { indexLintFindings } from '../indexer/lints/findings'

describe('flow suspend lint findings', () => {
  it('reports duplicate literal suspend names in one flow body', async () => {
    const findings = await lintFindingsForSource([
      "export const review = flow('review', async (flow) => {",
      "  await flow.suspend('approval')",
      "  await flow.suspend('approval')",
      '})',
    ])

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'flow.duplicate_suspend_name',
          message: expect.stringContaining('"approval"'),
        }),
      ]),
    )
  })

  it('reports literal suspend names missing from the local signal map', async () => {
    const findings = await lintFindingsForSource([
      "export const review = flow('review', {",
      '  signals: {',
      '    approval: approvalSchema,',
      '  },',
      '}, async (flow) => {',
      "  await flow.suspend('release')",
      '})',
    ])

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'flow.undeclared_suspend_signal',
          message: expect.stringContaining('"release"'),
        }),
      ]),
    )
  })
})

async function lintFindingsForSource(lines: readonly string[]) {
  const root = '/fixture'
  const file = '/fixture/src/flows.ts'
  const extraction = createStaticExtraction({
    root,
    cache: 'none',
    sources: memorySourceReader({ [file]: lines.join('\n') }),
  })
  const extracted = await extraction.extractFile(file)
  return indexLintFindings({
    definitions: extracted.definitions,
    relations: extracted.relations,
  })
}

function memorySourceReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    read: async (file) => {
      const source = files[file]
      if (source === undefined) throw new Error(`Missing fixture source: ${file}`)
      return source
    },
  }
}
