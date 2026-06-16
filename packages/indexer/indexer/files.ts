import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'tinyglobby'
import { classifyStaticCandidateFile, type StaticCandidateClassification } from './candidates'

const CONFIG_NAMES = ['crux.config.ts', 'crux.config.js', 'crux.config.mjs']
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.cache/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/generated/**',
]
const DEFAULT_IGNORE_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'generated',
  '.venv',
  '.cache',
])
const DEFAULT_EVAL_GLOBS = ['**/*.eval.ts', '**/*.eval.tsx', '**/*.eval.js', '**/*.eval.mjs']
const DEFAULT_STATIC_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs', ...CONFIG_NAMES]
const DEFAULT_STATIC_IGNORES = [
  ...DEFAULT_IGNORES,
  '**/.crux/cache/**',
  '**/*.d.ts',
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/*.test.*',
  '**/*.spec.*',
]

export interface IndexFileConfig {
  quality?: {
    include?: string | readonly string[]
    exclude?: string | readonly string[]
  }
}

export interface StaticDefinitionFileSelection {
  files: string[]
  skipped: StaticCandidateClassification[]
}

export interface StaticDefinitionFileSelectionOptions {
  readonly additionalCallNames?: readonly string[]
}

export function findConfigFiles(root: string): string[] {
  for (const name of CONFIG_NAMES) {
    const candidate = join(root, name)
    if (existsSync(candidate)) return [candidate]
  }
  return walkFilesSyncFallback(root, (file) =>
    CONFIG_NAMES.some((name) => file.endsWith(`/${name}`) || file.endsWith(`\\${name}`)),
  ).sort()
}

export function staticDefinitionFiles(root: string): string[] {
  return staticDefinitionFileSelection(root).files
}

export function staticDefinitionFileSelection(
  root: string,
  options: StaticDefinitionFileSelectionOptions = {},
): StaticDefinitionFileSelection {
  const skipped: StaticCandidateClassification[] = []
  const files = globSync(DEFAULT_STATIC_GLOBS, {
    cwd: root,
    absolute: true,
    ignore: DEFAULT_STATIC_IGNORES,
  })
    .map((file) => classifyStaticCandidateFile(file, { additionalCallNames: options.additionalCallNames }))
    .filter((classification): classification is Extract<StaticCandidateClassification, { action: 'index' }> => {
      if (classification.action === 'skip') {
        skipped.push(classification)
        return false
      }
      return true
    })
    .map((classification) => classification.file)
    .sort()
  return { files, skipped }
}

export function evalGlobs(loaded: IndexFileConfig): string[] {
  const include = patternsFrom(loaded.quality?.include)
  const exclude = patternsFrom(loaded.quality?.exclude).map((pattern) => `!${pattern}`)
  return [...(include.length > 0 ? include : DEFAULT_EVAL_GLOBS), ...exclude]
}

export function codeFilesFromGlobs(root: string, patterns: readonly string[]): string[] {
  const codePatterns = patterns.filter((pattern) => !pattern.endsWith('.json') && !pattern.includes('*.json'))
  return globSync(codePatterns, { cwd: root, absolute: true, ignore: DEFAULT_IGNORES })
}

function walkFilesSyncFallback(root: string, include: (file: string) => boolean): string[] {
  const files: string[] = []
  const stack = [root]
  const maxFiles = 5_000

  while (stack.length > 0 && files.length < maxFiles) {
    const dir = stack.pop()
    if (!dir) continue
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORE_DIR_NAMES.has(entry.name)) stack.push(path)
        continue
      }
      if (entry.isFile() && include(path)) files.push(path)
    }
  }

  return files
}

function patternsFrom(value: string | readonly string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? [...value] : [value as string]
}
