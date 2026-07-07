import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SourceResolver } from '../source-resolver'
import type { SourceResolverFileSystem } from '../source-resolver'

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

  it('retries missing source maps so rebuild races recover', async () => {
    let sourceMapAvailable = false
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
      exists: (path) => sourceMapAvailable && path === '/project/dist/bundle.js.map',
      readFile: async (path) => {
        reads.push(path)
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(resolver.resolveLocation('/project/dist/bundle.js', 1, 0)).resolves.toMatchObject({
      resolved: false,
    })
    sourceMapAvailable = true
    await expect(resolver.resolveLocation('/project/dist/bundle.js', 1, 0)).resolves.toMatchObject({
      file: '../src/original.ts',
      line: 1,
      column: 0,
      resolved: true,
    })

    expect(reads).toEqual(['/project/dist/bundle.js', '/project/dist/bundle.js.map'])
  })

  it('resolves narrow authored source-frame snapshots from source-map content', async () => {
    const files: Record<string, string> = {
      '/project/dist/eval.js': 'ctx.expect(result).toBe("wrong")\n',
      '/project/dist/eval.js.map': JSON.stringify({
        version: 3,
        file: 'eval.js',
        sources: ['../src/support.eval.ts'],
        sourcesContent: [
          [
            'export const support = evaluate({',
            '  expect: (ctx) => {',
            '    ctx.expect(ctx.output.answer).toBe("wrong")',
            '  },',
            '})',
          ].join('\n'),
        ],
        names: [],
        mappings: 'AAAA',
      }),
    }
    const fileSystem: SourceResolverFileSystem = {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: async (path) => {
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(
      resolver.resolveSourceFrame('/project/dist/eval.js', 1, 0, {
        sourceRef: '/project/dist/eval.js:1:0',
        frameRadius: 2,
        role: 'failed',
        capturedAt: '2026-06-15T12:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      kind: 'source-frame',
      sourceRef: '/project/dist/eval.js:1:0',
      authoredFile: '../src/support.eval.ts',
      authoredLine: 1,
      authoredColumn: 0,
      frameStartLine: 1,
      frameEndLine: 3,
      capturedAt: '2026-06-15T12:00:00.000Z',
      stale: false,
      resolver: 'source-map',
      lines: [
        { line: 1, text: 'export const support = evaluate({', role: 'failed' },
        { line: 2, text: '  expect: (ctx) => {', role: 'context' },
        { line: 3, text: '    ctx.expect(ctx.output.answer).toBe("wrong")', role: 'context' },
      ],
    })
    const frame = await resolver.resolveSourceFrame('/project/dist/eval.js', 1, 0)
    expect(frame.kind === 'source-frame' ? frame.contentHash : '').toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('refuses source-map disk fallback outside the project root', async () => {
    const files: Record<string, string> = {
      '/project/dist/eval.js': 'ctx.expect(result).toBe("wrong")\n',
      '/project/dist/eval.js.map': JSON.stringify({
        version: 3,
        file: 'eval.js',
        sources: ['../../outside/secret.eval.ts'],
        names: [],
        mappings: 'AAAA',
      }),
      '/outside/secret.eval.ts': 'export const secret = true\n',
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
    const resolver = new SourceResolver({ fileSystem, projectRoot: '/project' })

    await expect(resolver.resolveSourceFrame('/project/dist/eval.js', 1, 0)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'source-outside-project',
    })
    expect(reads).toEqual(['/project/dist/eval.js.map'])
  })

  it('resolves direct authored source-frame snapshots from disk when no source map is needed', async () => {
    const files: Record<string, string> = {
      '/project/evals/support.eval.ts': [
        'export const support = evaluate({',
        '  expect: (ctx) => {',
        '    ctx.expect(ctx.output.answer).toBe("wrong")',
        '  },',
        '})',
      ].join('\n'),
    }
    const fileSystem: SourceResolverFileSystem = {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: async (path) => {
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(
      resolver.resolveSourceFrame('/project/evals/support.eval.ts', 3, 4, {
        sourceRef: '/project/evals/support.eval.ts:3:4',
        frameRadius: 1,
        role: 'passed',
        capturedAt: '2026-06-15T12:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      kind: 'source-frame',
      sourceRef: '/project/evals/support.eval.ts:3:4',
      authoredFile: '/project/evals/support.eval.ts',
      authoredLine: 3,
      authoredColumn: 4,
      frameStartLine: 2,
      frameEndLine: 4,
      capturedAt: '2026-06-15T12:00:00.000Z',
      stale: false,
      resolver: 'disk',
      lines: [
        { line: 2, text: '  expect: (ctx) => {', role: 'context' },
        { line: 3, text: '    ctx.expect(ctx.output.answer).toBe("wrong")', role: 'passed' },
        { line: 4, text: '  },', role: 'context' },
      ],
    })
  })

  it('returns unavailable instead of compiled output when no source map exists', async () => {
    const files: Record<string, string> = {
      '/project/dist/eval.js': 'ctx.expect(result).toBe("wrong")\n',
    }
    const fileSystem: SourceResolverFileSystem = {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: async (path) => {
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(resolver.resolveSourceFrame('/project/dist/eval.js', 1, 0)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'source-map-missing',
    })
  })

  it('returns unavailable when original source content is missing', async () => {
    const files: Record<string, string> = {
      '/project/dist/eval.js': 'ctx.expect(result).toBe("wrong")\n',
      '/project/dist/eval.js.map': JSON.stringify({
        version: 3,
        file: 'eval.js',
        sources: ['../src/support.eval.ts'],
        names: [],
        mappings: 'AAAA',
      }),
    }
    const fileSystem: SourceResolverFileSystem = {
      exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: async (path) => {
        const value = files[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    }
    const resolver = new SourceResolver({ fileSystem })

    await expect(resolver.resolveSourceFrame('/project/dist/eval.js', 1, 0)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'source-file-missing',
    })
  })
})
