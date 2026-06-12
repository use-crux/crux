import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stale-name guard (quality phase 6): the legacy eval surface is deleted; its
 * names must never reappear in source, docs, or examples. Catches drive-by
 * reintroductions (copy-pasted snippets, stale doc edits, generated examples).
 *
 * Patterns are built by concatenation so this guard does not flag itself.
 */
const STALE_NAMES: readonly string[] = [
  '@crux/core/' + 'testing',
  'evaluate' + 'Prompt',
  'flow' + 'Evaluation',
  'rag' + 'Evaluation',
  'q.' + 'evaluate(',
  'q.' + 'compare(',
]

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.md', '.mdx', '.json'])

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  '.crux',
  'pkg-web',
  'pkg-node',
  // Bundled worker/UI artifacts regenerated from source — source is scanned.
  'embed',
  'ui-embed',
  '.vercel',
  'out',
])

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const SELF = resolve(__filename)

function scannableFiles(root: string): string[] {
  const files: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      let stats
      try {
        stats = statSync(path)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry)) stack.push(path)
        continue
      }
      const dotIndex = entry.lastIndexOf('.')
      if (dotIndex === -1) continue
      if (SCANNED_EXTENSIONS.has(entry.slice(dotIndex))) files.push(path)
    }
  }
  return files
}

describe('stale legacy eval names', () => {
  it('do not appear anywhere in source, docs, or examples', () => {
    const offenders: string[] = []
    for (const file of scannableFiles(REPO_ROOT)) {
      if (resolve(file) === SELF) continue
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const name of STALE_NAMES) {
        if (content.includes(name)) {
          offenders.push(`${file.split(sep).join('/')} contains "${name}"`)
        }
      }
    }
    expect(offenders, `Legacy eval names found:\n${offenders.join('\n')}`).toEqual([])
  })
})
