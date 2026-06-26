import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTsgoExecutablePath } from '../indexer/semantic/backends/tsgo/executable'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveTsgoExecutablePath', () => {
  it('resolves the native-preview platform package from a workspace parent of the indexed root', async () => {
    const workspace = await tempWorkspace()
    const projectRoot = join(workspace, 'packages/backend')
    const packageRoot = join(workspace, 'node_modules/@typescript/native-preview-linux-x64')
    const executable = join(packageRoot, 'lib/tsgo')

    await mkdir(join(projectRoot), { recursive: true })
    await writeFile(join(projectRoot, 'package.json'), '{"name":"backend"}')
    await mkdir(join(packageRoot, 'lib'), { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@typescript/native-preview-linux-x64',
        type: 'module',
        exports: { './package.json': './package.json' },
      }),
    )
    await writeFile(executable, '')

    expect(resolveTsgoExecutablePath({ root: projectRoot, platform: 'linux', arch: 'x64' })).toBe(executable)
  })

  it('preserves an explicitly configured tsgo executable path', () => {
    expect(
      resolveTsgoExecutablePath({
        root: '/project',
        explicitPath: '/opt/typescript-go/tsgo',
        platform: 'linux',
        arch: 'x64',
      }),
    ).toBe('/opt/typescript-go/tsgo')
  })

  it('reports an actionable diagnostic when the platform package cannot be resolved', async () => {
    const workspace = await tempWorkspace()
    const projectRoot = join(workspace, 'packages/backend')

    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'package.json'), '{"name":"backend"}')

    expect(() => resolveTsgoExecutablePath({ root: projectRoot, platform: 'aix', arch: 'x64' })).toThrow(
      /Native semantic indexing was requested, but @typescript\/native-preview-aix-x64 could not be resolved/,
    )
  })

  it('reports an actionable diagnostic when the platform package has no tsgo executable', async () => {
    const workspace = await tempWorkspace()
    const projectRoot = join(workspace, 'packages/backend')
    const packageRoot = join(workspace, 'node_modules/@typescript/native-preview-win32-x64')

    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'package.json'), '{"name":"backend"}')
    await mkdir(join(packageRoot, 'lib'), { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@typescript/native-preview-win32-x64',
        type: 'module',
        exports: { './package.json': './package.json' },
      }),
    )

    expect(() => resolveTsgoExecutablePath({ root: projectRoot, platform: 'win32', arch: 'x64' })).toThrow(
      /TypeScript-Go executable was not found/,
    )
  })
})

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-tsgo-'))
  tempRoots.push(root)
  return root
}
