import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const indexerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'indexer')
const tsgoBackendDir = join(indexerDir, 'semantic', 'backends', 'tsgo')

interface ForbiddenImport {
  readonly file: string
  readonly line: number
  readonly text: string
}

describe('semantic tsgo backend architecture boundaries', () => {
  it('does not import the JavaScript TypeScript runtime from the tsgo backend', () => {
    expect(forbiddenTypeScriptImports(tsgoBackendDir)).toEqual([])
  })
})

function forbiddenTypeScriptImports(root: string): readonly ForbiddenImport[] {
  return relativeFiles(root)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => forbiddenTypeScriptImportsInFile(root, file))
}

function forbiddenTypeScriptImportsInFile(root: string, file: string): readonly ForbiddenImport[] {
  const source = readFileSync(join(root, file), 'utf8')
  const violations: ForbiddenImport[] = []
  const forbiddenPatterns = [
    /\bfrom\s+['"]typescript['"]/g,
    /\brequire\(\s*['"]typescript['"]\s*\)/g,
    /\bimport\(\s*['"]typescript['"]\s*\)/g,
  ] as const

  for (const pattern of forbiddenPatterns) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0
      violations.push({
        file,
        line: lineNumberAt(source, index),
        text: source.slice(index, index + match[0].length),
      })
    }
  }

  return violations
}

function relativeFiles(root: string): readonly string[] {
  const files: string[] = []
  collectRelativeFiles(root, '', files)
  return files.sort()
}

function collectRelativeFiles(root: string, relativeRoot: string, files: string[]): void {
  for (const entry of readdirSync(join(root, relativeRoot))) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry}` : entry
    const absolutePath = join(root, relativePath)
    if (statSync(absolutePath).isDirectory()) {
      collectRelativeFiles(root, relativePath, files)
    } else {
      files.push(relativePath)
    }
  }
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}
