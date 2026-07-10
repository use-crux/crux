/**
 * Real child-process freeze harness fixture.
 *
 * Runs as a standalone Node entrypoint (bundled and spawned by
 * `serverless-freeze.test.ts`), never imported by Vitest directly. Exercises
 * `@use-crux/core/observability` under an actual `process.exit()` right
 * after the handler settles, mirroring a serverless host freezing/killing
 * the process immediately after it returns a response.
 *
 * Usage: node serverless-freeze-harness.bundle.mjs <mode> <resultFile> <sendDelayMs>
 *   mode: 'unbound' | 'wrapped' | 'deadline'
 */
import { appendFileSync, writeFileSync } from 'node:fs'

import {
  acceptedDeliveryReceipt,
  observe,
  setObservabilityTransport,
  withObservableInvocation,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
} from '../../../src/observability'

const mode = process.argv[2]
const resultFile = process.argv[3]
const sendDelayMs = Number(process.argv[4] ?? '0')

function appendResult(entry: Record<string, unknown>): void {
  appendFileSync(resultFile, `${JSON.stringify(entry)}\n`)
}

const transport: CruxObservabilityTransport = {
  send(records: readonly CruxGraphRecord[]) {
    return new Promise((resolve) => {
      setTimeout(() => {
        appendResult({ event: 'delivered', count: records.length })
        resolve(acceptedDeliveryReceipt(records))
      }, sendDelayMs)
    })
  },
}

writeFileSync(resultFile, '')
setObservabilityTransport(transport, { scheduledDelayMs: 0 })

async function run(): Promise<void> {
  if (mode === 'unbound') {
    // Fire-and-forget: no wrapper, no awaited flush. The batching/send timer
    // is still pending when the process freezes below.
    observe.openRun({ name: 'unbound', rootPrimitive: 'custom.operation' }).end()
    appendResult({ event: 'handler-returned' })
    process.exit(0)
  }

  if (mode === 'wrapped') {
    const handler = withObservableInvocation(async () => {
      observe.openRun({ name: 'wrapped', rootPrimitive: 'custom.operation' }).end()
      return 'ok'
    })
    await handler()
    appendResult({ event: 'handler-returned' })
    process.exit(0)
  }

  if (mode === 'deadline') {
    let drainResult: unknown
    const handler = withObservableInvocation(
      async () => {
        observe.openRun({ name: 'deadline', rootPrimitive: 'custom.operation' }).end()
        return 'ok'
      },
      () => ({ deadlineMs: Date.now() + 5, onDrain: (result) => (drainResult = result) }),
    )
    const result = await handler()
    appendResult({ event: 'handler-returned', result, drainResult })
    process.exit(0)
  }

  throw new Error(`unknown mode: ${mode}`)
}

void run()
