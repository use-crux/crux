import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'

/**
 * Phase 6 child-process freeze harness.
 *
 * Real `node` child processes, not mocked timers or a mocked `waitUntil`.
 * Each mode bundles `fixtures/serverless-freeze-harness.ts` and spawns it as
 * a standalone process that calls `process.exit()` immediately after its
 * handler settles — mirroring a serverless host freezing/killing the
 * process right after it returns a response — then asserts on the
 * synchronously-written result file that survives the exit.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixtureEntry = join(here, 'fixtures', 'serverless-freeze-harness.ts')

let bundlePath: string
let workDir: string

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'crux-observability-freeze-'))
  bundlePath = join(workDir, 'harness.bundle.mjs')
  await esbuild.build({
    entryPoints: [fixtureEntry],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  })
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function runHarness(mode: string, sendDelayMs: number): { resultFile: string; entries: Record<string, unknown>[] } {
  const resultFile = join(workDir, `result-${mode}-${sendDelayMs}.ndjson`)
  execFileSync(process.execPath, [bundlePath, mode, resultFile, String(sendDelayMs)], {
    encoding: 'utf8',
  })
  const raw = readFileSync(resultFile, 'utf8')
  const entries = raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { resultFile, entries }
}

describe('serverless child-process freeze (real process, no mocked waitUntil)', () => {
  it('loses an unbound fire-and-forget send when the child exits immediately after the handler returns', () => {
    // Transport takes 50ms to "deliver"; the process freezes at exit(0) well before that.
    const { entries } = runHarness('unbound', 50)

    const returned = entries.find((entry) => entry.event === 'handler-returned')
    const delivered = entries.find((entry) => entry.event === 'delivered')

    expect(returned).toBeDefined()
    // The batching/send timer never got to run before the process exited.
    expect(delivered).toBeUndefined()
  })

  it('drains accepted records before the wrapped invocation returns/exits', () => {
    const { entries } = runHarness('wrapped', 50)

    const returned = entries.find((entry) => entry.event === 'handler-returned')
    const delivered = entries.find((entry) => entry.event === 'delivered')

    expect(delivered).toBeDefined()
    expect((delivered!.count as number)).toBeGreaterThan(0)
    // Delivery is awaited inside the wrapper, so it is recorded before
    // the handler-returned marker that immediately precedes process.exit().
    expect(entries.indexOf(delivered!)).toBeLessThan(entries.indexOf(returned!))
  })

  it('a deadline-limited invocation truthfully reports remaining telemetry instead of claiming success', () => {
    // Transport takes 200ms; the invocation deadline is 5ms, so the final
    // flush cannot drain in time.
    const { entries } = runHarness('deadline', 200)

    const returned = entries.find((entry) => entry.event === 'handler-returned')
    expect(returned).toBeDefined()
    // The handler's own result is unaffected by delivery outcome...
    expect(returned!.result).toBe('ok')
    // ...and the wrapper's own `onDrain` receipt - not a diagnostics snapshot
    // reconstructed after the fact - truthfully reports the incomplete drain.
    const drainResult = returned!.drainResult as {
      status: string
      remaining: number
      deadlineExceeded: boolean
    }
    expect(drainResult).toBeDefined()
    expect(drainResult.status).toBe('deadline')
    expect(drainResult.deadlineExceeded).toBe(true)
    expect(drainResult.remaining).toBeGreaterThan(0)

    const delivered = entries.find((entry) => entry.event === 'delivered')
    expect(delivered).toBeUndefined()
  })

  it('delivers a terminal stream span end on freeze even though provider completion never arrives', () => {
    // Transport takes 20ms; the process freezes right after the handler
    // returns, with no completion promise ever settling. If span end still
    // depended on a grace timer, this span would never close.
    const { entries } = runHarness('stream', 20)

    const returned = entries.find((entry) => entry.event === 'handler-returned')
    const delivered = entries.filter((entry) => entry.event === 'delivered')
    const spanEndDelivery = delivered.find((entry) => entry.hasSpanEnd === true)

    expect(returned).toBeDefined()
    expect(returned!.result).toBe('ok')
    expect(delivered.length).toBeGreaterThan(0)
    expect(spanEndDelivery).toBeDefined()
    // Delivery (including the stream span's own end) is drained inside the
    // wrapper, so it is recorded before the handler-returned marker that
    // immediately precedes process.exit().
    expect(entries.indexOf(spanEndDelivery!)).toBeLessThan(entries.indexOf(returned!))
  })
})
