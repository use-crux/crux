/**
 * Stdio JSON-RPC wrapper for the SourceResolver class.
 * Spawned by the Go CLI as a lazy worker for source map resolution.
 *
 * Protocol: One JSON request per line on stdin → one JSON response per line on stdout.
 * Stderr is used for logging (forwarded to Go's stderr).
 */

import { createInterface } from 'node:readline'
import {
  SourceResolver,
  errorMessage,
  parseSourceResolverWorkerRequest,
  serializeSourceResolverWorkerResponse,
} from '@crux/indexer/source-resolver'

const resolver = new SourceResolver()

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

let pending = 0
let closing = false

// Stdin can close before an async resolution finishes. Drain pending responses before exiting so the
// Go worker reader always receives one JSON line for every accepted input line.
function maybeExit(): void {
  if (closing && pending === 0) process.exit(0)
}

async function writeResponse(value: unknown): Promise<void> {
  const line = serializeSourceResolverWorkerResponse(value)
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
    const parsed = parseSourceResolverWorkerRequest(line)
    if (!parsed.ok) {
      await writeResponse({ error: parsed.error })
      return
    }

    let result: unknown
    const req = parsed.request

    switch (req.method) {
      case 'resolveLocations': {
        const locations = await Promise.all(
          req.locations.map((loc) => resolver.resolveLocation(loc.file, loc.line, loc.column, loc.function)),
        )
        result = { locations }
        break
      }
      case 'resolveFnSource': {
        const fnSource = await resolver.resolveFnSource(req.file, req.line, req.column)
        result = fnSource ?? { source: null, resolved: false }
        break
      }
    }

    await writeResponse(result)
  } catch (err) {
    const message = errorMessage(err)
    process.stderr.write(`[source-resolver] error: ${message}\n`)
    await writeResponse({ error: message })
  }
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
