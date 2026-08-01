import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfigPolicyProjectConfig } from '../src/indexer/config'
import { importUserModule, resolveUserImportAliasForTest } from '../src/indexer/imports'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project TypeScript imports', () => {
  it("does not require projects to install the Indexer's TS loader", async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-indexer-import-'))
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
    const source = join(root, 'fixture.ts')
    await writeFile(source, 'export const answer: number = 42\n')

    await expect(importUserModule(source, 5_000)).resolves.toMatchObject({
      answer: 42,
    })
  })

  it('does not rewrite imports outside an authored import session', async () => {
    const root = await fixtureRoot('crux-indexer-unscoped-')
    const source = join(root, 'ordinary.mjs')
    await writeFile(source, 'export const url = import.meta.url\n')
    const sourceURL = pathToFileURL(source).href
    const imported = (await import(sourceURL)) as { readonly url: string }

    expect(imported.url).not.toContain('cruxImport=')
  })

  it('resolves transitive TypeScript path aliases within the authored root', async () => {
    const root = await fixtureRoot('crux-indexer-alias-')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    })
    await writeSource(join(root, 'src/value.ts'), 'export const value = 42\n')
    await writeSource(join(root, 'src/settings.ts'), 'import { value } from "@/value"\nexport const answer = value\n')
    const entry = join(root, 'crux.config.ts')
    await writeSource(entry, 'export { answer } from "./src/settings"\n')

    expect(resolveUserImportAliasForTest('@/value', join(root, 'src/settings.ts'), root).file).toBe(
      join(root, 'src/value.ts'),
    )
  })

  it('uses extended config options and records the complete config closure', async () => {
    const root = await fixtureRoot('crux-indexer-extends-')
    await writeJson(join(root, 'config/base.json'), {
      compilerOptions: { baseUrl: '..', paths: { '@/*': ['src/*'] } },
    })
    await writeJson(join(root, 'tsconfig.json'), { extends: './config/base.json' })
    await writeSource(join(root, 'src/value.ts'), 'export const value = true\n')
    await writeSource(
      join(root, 'crux.config.ts'),
      [
        'import { value } from "@/value"',
        'export default { config: { experimental: { indexer: { native: value } } }, prompts: [], contexts: [], get() {} }',
      ].join('\n'),
    )

    const imported = resolveUserImportAliasForTest('@/value', join(root, 'crux.config.ts'), root)

    expect(imported.identity.files).toEqual([join(root, 'config/base.json'), join(root, 'tsconfig.json')])
    expect(imported.identity.cacheDisabled).toBe(false)
    expect(imported.file).toBe(join(root, 'src/value.ts'))

    await writeSource(
      join(root, 'crux.config.ts'),
      'export default { config: {}, prompts: [], contexts: [], get() {} }\n',
    )
    const result = await loadConfigPolicyProjectConfig(root, undefined)
    expect(result.sources.map((source) => source.file)).toEqual(expect.arrayContaining([...result.configDependencies]))
  })

  it('resolves aliases from jsconfig.json', async () => {
    const root = await fixtureRoot('crux-indexer-jsconfig-')
    await writeJson(join(root, 'jsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    })
    await writeSource(join(root, 'src/value.js'), "export const value = 'jsconfig'\n")
    const entry = join(root, 'entry.js')
    await writeSource(entry, 'export { value } from "@/value"\n')

    expect(resolveUserImportAliasForTest('@/value', entry, root).file).toBe(join(root, 'src/value.js'))
  })

  it('falls back to Node when a matching authored alias has no source target', async () => {
    const root = await fixtureRoot('crux-indexer-alias-fallback-')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { collision: ['src/missing'] } },
    })
    await writePackage(root, 'collision', "export const value = 'node'\n")
    const entry = join(root, 'entry.ts')
    await writeSource(entry, 'export { value } from "collision"\n')

    expect(resolveUserImportAliasForTest('collision', entry, root).file).toBeUndefined()
    await expect(importUserModule(entry, 5_000, root)).resolves.toMatchObject({ value: 'node' })
  })

  it('lets an authored alias intentionally shadow an installed package', async () => {
    const root = await fixtureRoot('crux-indexer-alias-shadow-')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { collision: ['src/collision'] } },
    })
    await writeSource(join(root, 'src/collision.ts'), "export const value = 'authored'\n")
    await writePackage(root, 'collision', "export const value = 'node'\n")
    const entry = join(root, 'entry.ts')
    await writeSource(entry, 'export { value } from "collision"\n')

    expect(resolveUserImportAliasForTest('collision', entry, root).file).toBe(join(root, 'src/collision.ts'))
  })

  it('rejects authored alias targets outside the project boundary', async () => {
    const root = await fixtureRoot('crux-indexer-alias-contained-')
    const outside = join(dirname(root), `${basename(root)}-outside.ts`)
    roots.push(outside)
    await writeSource(outside, 'export const secret = true\n')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { danger: ['../' + basename(outside)] } },
    })
    await writePackage(root, 'danger', 'export const secret = "installed-package"\n')
    const entry = join(root, 'entry.ts')
    await writeSource(entry, 'export { secret } from "danger"\n')

    expect(() => resolveUserImportAliasForTest('danger', entry, root)).toThrow(
      /outside the authored project boundary/,
    )
  })

  it('rejects declaration-only alias resolutions', async () => {
    const root = await fixtureRoot('crux-indexer-alias-declaration-')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { declared: ['src/declared.d.ts'] } },
    })
    await writeSource(join(root, 'src/declared.d.ts'), 'export declare const value: string\n')
    const entry = join(root, 'entry.ts')
    await writeSource(entry, 'export { value } from "declared"\n')

    expect(() => resolveUserImportAliasForTest('declared', entry, root)).toThrow(
      /declaration file instead of executable source/,
    )
  })

  it('never applies authored aliases to Node builtins', async () => {
    const root = await fixtureRoot('crux-indexer-alias-builtin-')
    await writeJson(join(root, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { fs: ['src/fake-fs'], 'node:fs': ['src/fake-fs'] } },
    })
    await writeSource(join(root, 'src/fake-fs.ts'), 'export const fake = true\n')
    const entry = join(root, 'entry.ts')
    await writeSource(entry, 'export {}\n')

    expect(resolveUserImportAliasForTest('fs', entry, root).file).toBeUndefined()
    expect(resolveUserImportAliasForTest('node:fs', entry, root).file).toBeUndefined()
  })
})

async function fixtureRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  return root
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeSource(file, `${JSON.stringify(value)}\n`)
}

async function writeSource(file: string, source: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, source)
}

async function writePackage(root: string, name: string, source: string): Promise<void> {
  const directory = join(root, 'node_modules', name)
  await mkdir(directory, { recursive: true })
  await writeJson(join(directory, 'package.json'), { type: 'module', exports: './index.js' })
  await writeFile(join(directory, 'index.js'), source)
}
