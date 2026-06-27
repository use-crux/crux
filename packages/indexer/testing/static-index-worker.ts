import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { ProjectIndexWorkerEvent } from '../indexer/worker-protocol/types'
import { indexPatchFromWorkerEvents } from '../indexer/worker-protocol/patch-events'
import type { IndexPatchFacts } from '../indexer/patches'
import { staticIndexRunIdentityFixture } from '../contracts/static-index/fixtures'
import { rustOxcSyntaxFrontendTestStatus } from './rust-oxc-frontend'

const WORKSPACE_MANIFEST = fileURLToPath(new URL('../../../Cargo.toml', import.meta.url))
const INDEXER_PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

interface StaticIndexWorkerEnvelope {
  readonly id: number
  readonly ok: boolean
  readonly response?: {
    readonly method: string
    readonly events?: readonly ProjectIndexWorkerEvent[]
  }
  readonly error?: string
}

interface PendingRequest {
  readonly resolve: (response: StaticIndexWorkerEnvelope) => void
  readonly reject: (error: Error) => void
}

interface StaticIndexWorkerState {
  child: ChildProcessWithoutNullStreams | undefined
  nextId: number
  stderr: string
  pending: Map<number, PendingRequest>
}

const state: StaticIndexWorkerState = {
  child: undefined,
  nextId: 1,
  stderr: '',
  pending: new Map(),
}

/**
 * Finalize Static Index facts through the real Rust worker and return the
 * emitted Project Index patch facts.
 *
 * This is a test-only parity helper. Production worker supervision belongs to
 * Go; package tests use this to compare TypeScript baseline facts with native
 * finalization over the same JSON protocol shape.
 */
export async function finalizeStaticIndexFactsWithWorker(input: {
  readonly root: string
  readonly nativeFacts: readonly unknown[]
  readonly extensionFacts?: readonly unknown[]
  readonly lintFacts?: readonly unknown[]
  readonly lintConfig?: unknown
  readonly lintSuppressions?: readonly unknown[]
  readonly emitBuiltinLints?: boolean
}): Promise<IndexPatchFacts> {
  const response = await sendStaticIndexWorkerRequest({
    protocolVersion: 2,
    method: 'staticIndexFinalize',
    identity: staticIndexRunIdentityFixture,
    nativeFacts: input.nativeFacts,
    extensionFacts: input.extensionFacts ?? [],
    ...(input.lintFacts ? { lintFacts: input.lintFacts } : {}),
    ...(input.lintConfig ? { lintConfig: input.lintConfig } : {}),
    ...(input.lintSuppressions ? { lintSuppressions: input.lintSuppressions } : {}),
    ...(input.emitBuiltinLints !== undefined ? { emitBuiltinLints: input.emitBuiltinLints } : {}),
  })
  if (!response.ok) throw new Error(response.error ?? 'Static Index worker finalization failed')
  if (response.response?.method !== 'staticIndexFinalize' || !response.response.events) {
    throw new Error('Static Index worker returned an invalid finalize response')
  }
  return indexPatchFromWorkerEvents(response.response.events).facts
}

function sendStaticIndexWorkerRequest(request: Record<string, unknown>): Promise<StaticIndexWorkerEnvelope> {
  const child = ensureWorkerStarted()
  const id = state.nextId
  state.nextId += 1
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ id, ...request })}\n`, (error) => {
      if (!error) return
      state.pending.delete(id)
      reject(error)
    })
  })
}

function ensureWorkerStarted(): ChildProcessWithoutNullStreams {
  if (state.child && !state.child.killed) return state.child
  const command = workerCommand()
  const child = spawn(command.bin, command.args, {
    cwd: INDEXER_PACKAGE_ROOT,
    stdio: 'pipe',
  })
  state.child = child
  state.stderr = ''
  createInterface({ input: child.stdout }).on('line', handleWorkerLine)
  child.stderr.on('data', (chunk: Buffer) => {
    state.stderr = `${state.stderr}${chunk.toString('utf8')}`.slice(-4_000)
  })
  child.on('error', rejectAll)
  child.on('exit', (code, signal) => {
    rejectAll(new Error(`Static Index worker exited code=${code ?? 'null'} signal=${signal ?? 'null'} ${state.stderr}`))
    state.child = undefined
  })
  return child
}

function handleWorkerLine(line: string): void {
  let response: StaticIndexWorkerEnvelope
  try {
    response = JSON.parse(line) as StaticIndexWorkerEnvelope
  } catch (error) {
    rejectAll(
      new Error(`Invalid Static Index worker response: ${error instanceof Error ? error.message : String(error)}`),
    )
    return
  }
  const pending = state.pending.get(response.id)
  if (!pending) return
  state.pending.delete(response.id)
  pending.resolve(response)
}

function rejectAll(error: Error): void {
  for (const pending of state.pending.values()) pending.reject(error)
  state.pending.clear()
}

function workerCommand(): { readonly bin: string; readonly args: readonly string[] } {
  const explicitWorker = process.env.CRUX_STATIC_INDEX_WORKER?.trim()
  if (explicitWorker) return { bin: explicitWorker, args: ['serve'] }
  const status = rustOxcSyntaxFrontendTestStatus()
  if (!status.available) {
    throw new Error(`Static Index worker test helper is unavailable: ${status.reason ?? 'unknown reason'}`)
  }
  return {
    bin: 'cargo',
    args: [
      'run',
      '--quiet',
      '--manifest-path',
      WORKSPACE_MANIFEST,
      '--package',
      'crux-static-index-worker',
      '--bin',
      'crux-static-index-worker',
      '--',
      'serve',
    ],
  }
}
