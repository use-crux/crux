import { describe, expect, it } from 'vitest'
import { createParseMemo, type SourceReader } from '../indexer/static/extraction/source-io'

describe('static source memo', () => {
  it('shares one source read across text, parsed AST, and source profile metadata', async () => {
    const file = '/fixture/src/prompt.ts'
    const source = "export const writer = prompt({ id: 'writer' })"
    let reads = 0
    const sources: SourceReader = {
      read: async (requestedFile) => {
        reads += 1
        expect(requestedFile).toBe(file)
        return source
      },
    }
    const memo = createParseMemo(sources)

    const [raw, info, sourceFile] = await Promise.all([
      memo.readSource(file),
      memo.readSourceInfo(file),
      memo.readSourceFile(file),
    ])

    expect(raw).toBe(source)
    expect(info.source).toBe(source)
    expect(info.semanticProfile.file).toBe(file)
    expect(info.semanticProfile.sourceHash).toBe(info.sourceHash)
    expect(sourceFile.fileName).toBe(file)
    expect(reads).toBe(1)
  })
})
