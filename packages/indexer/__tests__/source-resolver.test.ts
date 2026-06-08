import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SourceResolver } from '../source-resolver'
import type { SourceResolverFileSystem } from '../source-resolver/index'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-source-resolver-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SourceResolver', () => {
  it('resolves bundled locations through a sidecar source map', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'dist'), { recursive: true })
    await mkdir(join(root, 'src'), { recursive: true })

    const bundledFile = join(root, 'dist', 'bundle.js')
    const originalSource = ['export function original() {', "  return 'from-original'", '}', ''].join('\n')

    await writeFile(join(root, 'src', 'original.ts'), originalSource)
    await writeFile(bundledFile, 'function original(){return"from-original"}\n')
    await writeFile(
      `${bundledFile}.map`,
      JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        sourcesContent: [originalSource],
        names: [],
        mappings: 'AAAA',
      }),
    )

    const resolver = new SourceResolver()

    await expect(resolver.resolveLocation(bundledFile, 1, 0, 'bundledOriginal')).resolves.toEqual({
      file: '../src/original.ts',
      line: 1,
      column: 0,
      function: 'bundledOriginal',
      resolved: true,
    })
  })

  it('caches resolved locations after the first source-map lookup', async () => {
    const files: Record<string, string> = {
      '/project/dist/bundle.js': 'function original(){return"from-original"}\n',
      '/project/dist/bundle.js.map': JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        sourcesContent: ['export const original = true\n'],
        names: [],
        mappings: 'AAAA',
      }),
    }
    const reads: string[] = []
    const fileSystem: SourceResolverFileSystem = {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: async (path) => {
        reads.push(path)
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await resolver.resolveLocation('/project/dist/bundle.js', 1, 0)
    await resolver.resolveLocation('/project/dist/bundle.js', 1, 0)

    expect(reads).toEqual(['/project/dist/bundle.js.map'])
  })

  it('caches missing source maps after the first unresolved lookup', async () => {
    const reads: string[] = []
    const fileSystem: SourceResolverFileSystem = {
      exists: () => false,
      readFile: async (path) => {
        reads.push(path)
        throw new Error(`missing ${path}`)
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(resolver.resolveLocation('/project/dist/missing-map.js', 1, 0)).resolves.toMatchObject({
      resolved: false,
    })
    await expect(resolver.resolveLocation('/project/dist/missing-map.js', 2, 0)).resolves.toMatchObject({
      resolved: false,
    })

    expect(reads).toEqual(['/project/dist/missing-map.js'])
  })
})
