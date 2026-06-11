#!/usr/bin/env tsx

/**
 * Stdio wrapper for Project Index indexing.
 *
 * Protocol: one JSON request per line on stdin, one JSON response per line on stdout.
 */

import { createInterface } from 'node:readline'
import {
  indexProject,
  indexProjectAst,
  indexProjectIncremental,
  indexProjectSemantic,
  type IndexPatchBudget,
  type IncrementalExecutionMode,
} from '@crux/indexer'
import type { ProjectIndexSnapshot } from '@crux/core/project-index'

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

let pending = 0
let closing = false

function maybeExit(): void {
  if (closing && pending === 0) process.exit(0)
}

async function writeResponse(value: unknown): Promise<void> {
  const line = JSON.stringify(value) + '\n'
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(line, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

rl.on('line', (line: string) => {
  pending += 1
  void handleLine(line).finally(() => {
    pending -= 1
    maybeExit()
  })
})

async function handleLine(line: string): Promise<void> {
  try {
    const req = JSON.parse(line) as {
      method?: string
      root?: string
      configPath?: string
      projectName?: string
      staticOnly?: boolean
      semanticBudget?: IndexPatchBudget
      previousIndex?: ProjectIndexSnapshot
      files?: readonly string[]
      deletedFiles?: readonly string[]
      mode?: IncrementalExecutionMode
      maxAffectedFiles?: number
    }
    switch (req.method) {
      case 'indexProject': {
        if (!req.root) throw new Error('indexProject requires root')
        const snapshot = await indexProject({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          staticOnly: req.staticOnly,
        })
        await writeResponse({ snapshot })
        break
      }
      case 'indexProjectAst': {
        if (!req.root) throw new Error('indexProjectAst requires root')
        const patch = await indexProjectAst({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          staticOnly: req.staticOnly,
        })
        await writeResponse({ patch })
        break
      }
      case 'indexProjectSemantic': {
        if (!req.root) throw new Error('indexProjectSemantic requires root')
        const patch = await indexProjectSemantic({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          semanticBudget: req.semanticBudget,
          previousIndex: req.previousIndex,
        })
        await writeResponse({ patch })
        break
      }
      case 'indexProjectIncremental': {
        if (!req.root) throw new Error('indexProjectIncremental requires root')
        if (!req.previousIndex) throw new Error('indexProjectIncremental requires previousIndex')
        const result = await indexProjectIncremental({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          previousIndex: req.previousIndex,
          files: req.files ?? [],
          deletedFiles: req.deletedFiles,
          mode: req.mode ?? 'ast-and-semantic',
          maxAffectedFiles: req.maxAffectedFiles,
        })
        await writeResponse(result)
        break
      }
      default:
        await writeResponse({ error: `unknown method: ${req.method}` })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[project-indexer] error: ${message}\n`)
    await writeResponse({ error: message })
  }
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
