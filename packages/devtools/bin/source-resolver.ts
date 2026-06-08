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

rl.on('line', async (line: string) => {
  try {
    const parsed = parseSourceResolverWorkerRequest(line)
    if (!parsed.ok) {
      process.stdout.write(serializeSourceResolverWorkerResponse({ error: parsed.error }))
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

    process.stdout.write(serializeSourceResolverWorkerResponse(result))
  } catch (err) {
    const message = errorMessage(err)
    process.stderr.write(`[source-resolver] error: ${message}\n`)
    process.stdout.write(serializeSourceResolverWorkerResponse({ error: message }))
  }
})

rl.on('close', () => {
  process.exit(0)
})
