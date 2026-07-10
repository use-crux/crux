import { describe, expect, it } from 'vitest'
import { parseTraceMap } from '../src/source-resolver/trace-map'
import { loadOriginalSource, resolveOriginalPath } from '../src/source-resolver/original-source'
import type { SourceResolverFileSystem } from '../src/source-resolver/filesystem'

function memoryFileSystem(files: Readonly<Record<string, string>>): SourceResolverFileSystem {
  return {
    exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    readFile: async (path) => {
      const value = files[path]
      if (value === undefined) throw new Error(`missing ${path}`)
      return value
    },
  }
}

describe('source resolver original source loading', () => {
  it('prefers sourcesContent over disk fallback', async () => {
    const traceMap = parseTraceMap(
      JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        sourcesContent: ['from sourcesContent'],
        names: [],
        mappings: 'AAAA',
      }),
    )

    await expect(
      loadOriginalSource(traceMap!, '/project/dist/bundle.js', '../src/original.ts', memoryFileSystem({})),
    ).resolves.toBe('from sourcesContent')
  })

  it('falls back to disk when sourcesContent is absent', async () => {
    const traceMap = parseTraceMap(
      JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        names: [],
        mappings: 'AAAA',
      }),
    )
    const originalPath = '/project/src/original.ts'

    await expect(
      loadOriginalSource(
        traceMap!,
        '/project/dist/bundle.js',
        '../src/original.ts',
        memoryFileSystem({ [originalPath]: 'from disk' }),
      ),
    ).resolves.toBe('from disk')
  })

  it('returns null when original source cannot be loaded', async () => {
    const traceMap = parseTraceMap(
      JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        names: [],
        mappings: 'AAAA',
      }),
    )

    await expect(
      loadOriginalSource(traceMap!, '/project/dist/bundle.js', '../src/original.ts', memoryFileSystem({})),
    ).resolves.toBeNull()
  })

  it('resolves original paths relative to the bundle directory', () => {
    expect(resolveOriginalPath('/project/dist/bundle.js', '../src/original.ts')).toBe('/project/src/original.ts')
  })
})
