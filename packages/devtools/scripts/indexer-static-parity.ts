#!/usr/bin/env tsx

/**
 * Strict static frontend parity check for Project Index architecture work.
 *
 * Compares TypeScript-backed and Oxc-backed static extraction output across the production static
 * source selection. Any mismatch fails the process and prints compact details for the first files.
 *
 * @module
 */

import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStaticSyntaxFrontends, type StaticFrontendName } from '../lib/indexer-static-comparison'

interface StaticParityArgs {
  readonly root: string
  readonly concurrency: number
  readonly maxMismatchDetails: number
  readonly actualFrontend: Exclude<StaticFrontendName, 'typescript'>
}

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Project Index static parity root: ${args.root}`)
  console.log(`mode: typescript syntax frontend vs ${args.actualFrontend} syntax frontend concurrency=${args.concurrency}`)

  const result = await compareStaticSyntaxFrontends(args)
  console.log(
    [
      `files=${result.files}`,
      `matched=${result.matched}`,
      `mismatches=${result.mismatchCount}`,
      `errors=${result.errors.length}`,
    ].join(' '),
  )
  printTotals('typescript', result.typescript)
  printTotals(result.actualFrontend, result.actual)

  for (const mismatch of result.mismatches) {
    console.log(`mismatch: ${mismatch.relativeFile} fields=${mismatch.changedFields.join(',')}`)
    console.log(`  typescript=${JSON.stringify(mismatch.typescript).slice(0, 1_200)}`)
    console.log(`  ${result.actualFrontend}=${JSON.stringify(mismatch.actual).slice(0, 1_200)}`)
  }
  for (const error of result.errors.slice(0, args.maxMismatchDetails)) {
    console.log(`error: ${error.file} ${error.message}`)
  }

  if (result.mismatchCount > 0 || result.errors.length > 0) {
    process.exitCode = 1
  }
}

function parseArgs(argv: readonly string[]): StaticParityArgs {
  const rootFlag = valueFlag(argv, '--root')
  return {
    root: resolveRoot(rootFlag ?? WORKSPACE_ROOT),
    concurrency: positiveInteger(valueFlag(argv, '--concurrency'), 8),
    maxMismatchDetails: positiveInteger(valueFlag(argv, '--max-mismatches'), 10),
    actualFrontend: actualFrontend(valueFlag(argv, '--actual')),
  }
}

function actualFrontend(value: string | undefined): Exclude<StaticFrontendName, 'typescript'> {
  if (value === undefined) return 'oxc-rust'
  if (value === 'oxc-rust') return value
  throw new Error(`Expected --actual=oxc-rust, received ${value}`)
}

function printTotals(label: string, totals: { definitions: number; relations: number; diagnostics: number }): void {
  console.log(
    `  ${label}: definitions=${totals.definitions} relations=${totals.relations} diagnostics=${totals.diagnostics}`,
  )
}

function valueFlag(argv: readonly string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function resolveRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`)
  return parsed
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
