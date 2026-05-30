/**
 * Stdio JSON-RPC wrapper for the SourceResolver class.
 * Spawned by the Go CLI as a lazy worker for source map resolution.
 *
 * Protocol: One JSON request per line on stdin → one JSON response per line on stdout.
 * Stderr is used for logging (forwarded to Go's stderr).
 */

import { createInterface } from 'node:readline'
import { SourceResolver } from '@crux/source-indexer/source-resolver'

const resolver = new SourceResolver()

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

rl.on('line', async (line: string) => {
  try {
    const req = JSON.parse(line)

    let result: unknown

    switch (req.method) {
      case 'resolveLocations': {
        const locations = await Promise.all(
          (req.locations ?? []).map((loc: { file: string; line: number; column?: number; function?: string }) =>
            resolver.resolveLocation(loc.file, loc.line, loc.column, loc.function),
          ),
        )
        result = { locations }
        break
      }
      case 'resolveFnSource': {
        const fnSource = await resolver.resolveFnSource(req.file, req.line, req.column)
        result = fnSource ?? { source: null, resolved: false }
        break
      }
      default:
        result = { error: `unknown method: ${req.method}` }
    }

    process.stdout.write(JSON.stringify(result) + '\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[source-resolver] error: ${message}\n`)
    process.stdout.write(JSON.stringify({ error: message }) + '\n')
  }
})

rl.on('close', () => {
  process.exit(0)
})
