import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { IndexSourceFile, ProjectIndexSnapshot } from '@crux/core/project-index'

export type WatchScenarioName =
  | 'leaf-prompt-edit'
  | 'imported-helper-edit'
  | 'unrelated-helper-edit'
  | 'config-edit'
  | 'deleted-file'

export interface WatchMutation {
  readonly file: string
  readonly deleted: boolean
  readonly apply: () => void
}

export const WATCH_SCENARIOS: readonly WatchScenarioName[] = [
  'leaf-prompt-edit',
  'imported-helper-edit',
  'unrelated-helper-edit',
  'config-edit',
  'deleted-file',
]

const WALK_EXCLUDED_NAMES = new Set([
  '.cache',
  '.crux',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

/** Selects and prepares the filesystem mutation for one watch benchmark scenario. */
export function prepareMutation(
  root: string,
  scenario: WatchScenarioName,
  index: ProjectIndexSnapshot,
): WatchMutation | undefined {
  switch (scenario) {
    case 'leaf-prompt-edit': {
      const source = findSource(index, (candidate) => hasDefinitions(candidate) && !hasDependents(candidate))
      return source && appendMutation(source.file, scenario)
    }
    case 'imported-helper-edit': {
      const source = findSource(index, (candidate) => !hasDefinitions(candidate) && hasDependents(candidate))
      return source && appendMutation(source.file, scenario)
    }
    case 'unrelated-helper-edit': {
      const source = findSource(
        index,
        (candidate) => !hasDefinitions(candidate) && !hasDependents(candidate) && !hasDependencies(candidate),
      )
      const file = source?.file ?? findUnindexedTypeScriptFile(root, index)
      return file && appendMutation(file, scenario)
    }
    case 'config-edit': {
      const file = findConfigBoundary(root)
      return file && appendMutation(file, scenario)
    }
    case 'deleted-file': {
      const source = findSource(index, (candidate) => hasDefinitions(candidate) && !hasDependents(candidate))
      return source && { file: source.file, deleted: true, apply: () => unlinkSync(source.file) }
    }
  }
}

function appendMutation(file: string, scenario: WatchScenarioName): WatchMutation {
  return {
    file,
    deleted: false,
    apply: () => {
      if (file.endsWith('.json')) {
        writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\n`)
      } else {
        appendFileSync(file, `\n// crux watch benchmark: ${scenario} ${Date.now()}\n`)
      }
    },
  }
}

function findSource(index: ProjectIndexSnapshot, predicate: (source: IndexSourceFile) => boolean): IndexSourceFile | undefined {
  return index.sources?.find((source) => source.status !== 'deleted' && existsSync(source.file) && predicate(source))
}

function findConfigBoundary(root: string): string | undefined {
  for (const file of ['crux.config.ts', 'crux.config.js', 'crux.config.mjs', 'package.json', 'tsconfig.json', 'pnpm-workspace.yaml']) {
    const candidate = resolve(root, file)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function findUnindexedTypeScriptFile(root: string, index: ProjectIndexSnapshot): string | undefined {
  const indexed = new Set(index.sources?.map((source) => source.file) ?? [])
  return walkTypeScriptFiles(root, indexed, 0)
}

function walkTypeScriptFiles(dir: string, indexed: ReadonlySet<string>, depth: number): string | undefined {
  if (depth > 6) return undefined
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (WALK_EXCLUDED_NAMES.has(entry.name)) continue
    const file = join(dir, entry.name)
    if (entry.isDirectory()) {
      const child = walkTypeScriptFiles(file, indexed, depth + 1)
      if (child) return child
      continue
    }
    if (!entry.isFile() || indexed.has(file) || file.endsWith('.d.ts')) continue
    if ((file.endsWith('.ts') || file.endsWith('.tsx')) && statSync(file).size < 256 * 1024) {
      return file
    }
  }
  return undefined
}

function hasDefinitions(source: IndexSourceFile): boolean {
  return (source.definitionIds?.length ?? 0) > 0
}

function hasDependencies(source: IndexSourceFile): boolean {
  return (source.dependencies?.length ?? 0) > 0
}

function hasDependents(source: IndexSourceFile): boolean {
  return (source.dependents?.length ?? 0) > 0
}
