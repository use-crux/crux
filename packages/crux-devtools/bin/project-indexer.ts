#!/usr/bin/env tsx

/**
 * Stdio wrapper for Project Catalog indexing.
 *
 * Protocol: one JSON request per line on stdin, one JSON response per line on stdout.
 */

import { createInterface } from 'node:readline'
import { indexProject } from '@crux/source-indexer'

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
    const req = JSON.parse(line) as { method?: string; root?: string; configPath?: string; projectName?: string; staticOnly?: boolean }
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
