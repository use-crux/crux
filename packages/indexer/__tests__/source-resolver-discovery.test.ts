import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverSourceMap, normalizePath } from '../src/source-resolver/discovery'
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

describe('source map discovery', () => {
  it('prefers a sidecar source map', async () => {
    const bundle = '/project/dist/bundle.js'
    const fs = memoryFileSystem({
      [bundle]: 'console.log("bundle")',
      [`${bundle}.map`]: '{"version":3}',
    })

    await expect(discoverSourceMap(bundle, fs)).resolves.toEqual({
      kind: 'found',
      mapJson: '{"version":3}',
      source: 'sidecar',
    })
  })

  it('loads a relative sourceMappingURL from the bundle directory', async () => {
    const bundle = join('/project', 'dist', 'bundle.js')
    const map = join('/project', 'dist', 'maps', 'bundle.js.map')
    const fs = memoryFileSystem({
      [bundle]: 'console.log("bundle")\n//# sourceMappingURL=maps/bundle.js.map',
      [map]: '{"version":3}',
    })

    await expect(discoverSourceMap(bundle, fs)).resolves.toEqual({
      kind: 'found',
      mapJson: '{"version":3}',
      source: 'relative-url',
    })
  })

  it('decodes an inline base64 source map', async () => {
    const bundle = '/project/dist/bundle.js'
    const encoded = Buffer.from('{"version":3}', 'utf-8').toString('base64')
    const fs = memoryFileSystem({
      [bundle]: `console.log("bundle")\n//# sourceMappingURL=data:application/json;base64,${encoded}`,
    })

    await expect(discoverSourceMap(bundle, fs)).resolves.toEqual({
      kind: 'found',
      mapJson: '{"version":3}',
      source: 'inline',
    })
  })

  it('returns a typed miss when the bundle cannot be read', async () => {
    await expect(discoverSourceMap('/missing/bundle.js', memoryFileSystem({}))).resolves.toEqual({
      kind: 'not-found',
      reason: 'bundle-not-readable',
    })
  })

  it('returns a typed miss for invalid inline source map URLs', async () => {
    const bundle = '/project/dist/bundle.js'
    const fs = memoryFileSystem({
      [bundle]: 'console.log("bundle")\n//# sourceMappingURL=data:application/json,not-base64',
    })

    await expect(discoverSourceMap(bundle, fs)).resolves.toEqual({
      kind: 'not-found',
      reason: 'inline-map-invalid',
    })
  })

  it('normalizes file URLs without changing ordinary paths', () => {
    expect(normalizePath('/project/dist/bundle.js')).toBe('/project/dist/bundle.js')
    expect(normalizePath('file:///project/dist/bundle.js')).toBe('/project/dist/bundle.js')
  })
})
