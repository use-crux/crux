import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

export interface BenchmarkFixtureArgs {
  readonly packages: number
  readonly filesPerPackage: number
}

/** Creates a workspace fixture with no-zod prompt/context/tool relations. */
export function createMonorepoFixture(args: BenchmarkFixtureArgs): { readonly root: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'crux-indexer-monorepo-'))
  writeFileSync(rootPath(root, 'package.json'), JSON.stringify({ name: '@fixture/benchmark', private: true }, null, 2))
  writeFileSync(rootPath(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')

  for (let packageIndex = 0; packageIndex < args.packages; packageIndex += 1) {
    const packageRoot = rootPath(root, `packages/pkg-${packageIndex}`)
    mkdirSync(rootPath(packageRoot, 'src'), { recursive: true })
    writeFileSync(
      rootPath(packageRoot, 'package.json'),
      JSON.stringify({ name: `@fixture/pkg-${packageIndex}` }, null, 2),
    )
    writeFileSync(rootPath(packageRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }, null, 2))
    writeFileSync(rootPath(packageRoot, 'src/schema.ts'), schemaSource(packageIndex))
    writeFileSync(rootPath(packageRoot, 'src/unrelated.ts'), unrelatedSource(packageIndex))
    for (let fileIndex = 0; fileIndex < args.filesPerPackage; fileIndex += 1) {
      writeFileSync(rootPath(packageRoot, `src/prompt-${fileIndex}.ts`), promptSource(packageIndex, fileIndex))
    }
  }

  return { root }
}

function promptSource(packageIndex: number, fileIndex: number): string {
  return [
    "import { context, prompt, tool } from '@crux/core'",
    "import { packageSchemaLabel } from './schema'",
    '',
    'void packageSchemaLabel',
    '',
    `export const context${fileIndex} = context({ id: 'pkg-${packageIndex}.context-${fileIndex}' })`,
    `export const tool${fileIndex} = tool({ name: 'pkg-${packageIndex}.tool-${fileIndex}', execute: async () => ({}) })`,
    `export const prompt${fileIndex} = prompt({`,
    `  id: 'pkg-${packageIndex}.prompt-${fileIndex}',`,
    `  system: 'Package ${packageIndex} prompt ${fileIndex}.',`,
    "  prompt: 'Draft the response.',",
    `  use: [context${fileIndex}],`,
    `  tools: { tool${fileIndex} },`,
    '})',
    '',
  ].join('\n')
}

function schemaSource(packageIndex: number): string {
  return [
    `export const packageSchemaLabel = 'pkg-${packageIndex}.schema'`,
    '',
    'export interface PackageSchemaInput {',
    '  readonly value: string',
    '}',
    '',
  ].join('\n')
}

function unrelatedSource(packageIndex: number): string {
  return [`export const unrelatedBenchmarkValue${packageIndex} = ${packageIndex}`, ''].join('\n')
}

function rootPath(root: string, path: string): string {
  return resolve(root, path)
}
