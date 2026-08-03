import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const execFileAsync = promisify(execFile)

it('loads the production SSF import under native Node ESM', async () => {
  const source = await readFile(join(packageRoot, 'src/parsers.ts'), 'utf8')
  const match = source.match(/^(import (?:\* as )?(\w+) from 'ssf')$/mu)
  expect(match).toBeTruthy()

  const root = await mkdtemp(join(packageRoot, '.tmp-ssf-interop-'))
  try {
    const checkFile = join(root, 'check.mjs')
    await writeFile(
      checkFile,
      `${match![1]}\nif (${match![2]}.format('0%', 0.2) !== '20%') throw new Error('SSF percentage formatting failed')\n`,
    )
    await execFileAsync(process.execPath, [checkFile], { cwd: packageRoot })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
