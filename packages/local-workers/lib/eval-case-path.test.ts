import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAuthoredCaseFile } from './eval-case-path'

describe('authored caseFile path resolution', () => {
  it('resolves like an import and emits canonical project-relative POSIX identity', async () => {
    const root = await projectFixture()
    await mkdir(join(root, 'evals', 'support', 'fixtures'))
    await writeFile(join(root, 'evals', 'support', 'fixtures', 'refunds.jsonl'), '{}\n')
    const dependencies: string[] = []

    const resolved = await resolveAuthoredCaseFile({
      projectRoot: root,
      sourceFile: 'evals/support/support.eval.ts',
      sidecarFile: 'evals/support/support.cases.jsonl',
      authoredPath: './fixtures/../fixtures/refunds.jsonl',
      registerWatchDependency: (path) => dependencies.push(path),
    })

    expect(resolved).toEqual({
      absolutePath: join(root, 'evals', 'support', 'fixtures', 'refunds.jsonl'),
      canonicalPath: 'evals/support/fixtures/refunds.jsonl',
      exists: true,
    })
    expect(dependencies).toEqual(['evals/support/fixtures/refunds.jsonl'])
  })

  it('allows parent traversal only when the real target stays in the project', async () => {
    const root = await projectFixture()
    await mkdir(join(root, 'evals', 'fixtures'))
    await writeFile(join(root, 'evals', 'fixtures', 'shared.json'), '[]')

    await expect(resolve(root, '../fixtures/shared.json')).resolves.toMatchObject({
      canonicalPath: 'evals/fixtures/shared.json',
    })
    await expect(resolve(root, '../../../outside.json')).rejects.toThrow(/support\.eval\.ts.*\.\.\/\.\.\/\.\.\/outside\.json.*outside the project root/i)
  })

  it.each(['/tmp/cases.jsonl', 'C:\\cases.jsonl', 'C:/cases.jsonl', '\\\\server\\share\\cases.jsonl'])(
    'rejects absolute authored path %s',
    async (authoredPath) => {
      const root = await projectFixture()
      await expect(resolve(root, authoredPath)).rejects.toThrow(/support\.eval\.ts.*absolute.*relative/i)
    },
  )

  it('rejects symlink escapes and accepts a symlinked configured root', async () => {
    const realRoot = await projectFixture()
    const outside = await mkdtemp(join(tmpdir(), 'crux-eval-outside-'))
    await writeFile(join(outside, 'escape.jsonl'), '{}\n')
    await symlink(outside, join(realRoot, 'evals', 'support', 'escape'))

    await expect(resolve(realRoot, './escape/escape.jsonl')).rejects.toThrow(/outside the project root/i)

    const rootLink = `${realRoot}-link`
    await symlink(realRoot, rootLink)
    await mkdir(join(realRoot, 'evals', 'support', 'fixtures'))
    await writeFile(join(realRoot, 'evals', 'support', 'fixtures', 'inside.jsonl'), '{}\n')
    await expect(resolve(rootLink, './fixtures/inside.jsonl')).resolves.toMatchObject({
      absolutePath: join(realRoot, 'evals', 'support', 'fixtures', 'inside.jsonl'),
      canonicalPath: 'evals/support/fixtures/inside.jsonl',
    })
  })

  it('registers the canonical missing target without falling back to project root', async () => {
    const root = await projectFixture()
    await writeFile(join(root, 'missing.jsonl'), '{}\n')
    const dependencies: string[] = []

    await expect(
      resolve(root, './missing.jsonl', (path) => dependencies.push(path)),
    ).rejects.toThrow(/evals\/support\/support\.eval\.ts.*\.\/missing\.jsonl.*evals\/support\/missing\.jsonl.*relative to the declaring Eval directory/i)
    expect(dependencies).toEqual(['evals/support/missing.jsonl'])
  })

  it('rejects non-files and authored aliases of the automatic sibling', async () => {
    const root = await projectFixture()
    await mkdir(join(root, 'evals', 'support', 'directory.jsonl'))
    await writeFile(join(root, 'evals', 'support', 'support.cases.jsonl'), '{}\n')
    await symlink('support.cases.jsonl', join(root, 'evals', 'support', 'sidecar-alias.jsonl'))

    await expect(resolve(root, './directory.jsonl')).rejects.toThrow(/regular.*file/i)
    await expect(resolve(root, './sidecar-alias.jsonl')).rejects.toThrow(/loaded automatically.*Remove the caseFile/i)
  })
})

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-eval-path-'))
  await mkdir(join(root, 'evals', 'support'), { recursive: true })
  await writeFile(join(root, 'evals', 'support', 'support.eval.ts'), '// fixture\n')
  return root
}

function resolve(
  projectRoot: string,
  authoredPath: string,
  registerWatchDependency?: (path: string) => void,
) {
  return resolveAuthoredCaseFile({
    projectRoot,
    sourceFile: 'evals/support/support.eval.ts',
    sidecarFile: 'evals/support/support.cases.jsonl',
    authoredPath,
    ...(registerWatchDependency !== undefined ? { registerWatchDependency } : {}),
  })
}
