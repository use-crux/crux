import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type {
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendOptions,
} from '../indexer/static-index/syntax'
import { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from '../indexer/static-index/syntax'

const DEFAULT_CONSTRUCTOR_NAMES = ['Agent'] as const
const MIN_RUSTC_VERSION = [1, 93, 0] as const
const WORKSPACE_MANIFEST = fileURLToPath(new URL('../../../Cargo.toml', import.meta.url))
const INDEXER_PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

interface RustOxcWorkerRequest {
  readonly id: number
  readonly root: string
  readonly file: string
  readonly source?: string
  readonly readSourceFromDisk?: boolean
  readonly callNames: readonly string[]
  readonly callInterests: readonly RustOxcWorkerCallInterest[]
  readonly constructorNames: readonly string[]
  readonly constructorInterests: readonly RustOxcWorkerConstructorInterest[]
  readonly pruneNativeFactCallNames: readonly string[]
}

interface RustOxcWorkerBatchRequest {
  readonly id: number
  readonly files: readonly RustOxcWorkerFileRequest[]
  readonly callNames: readonly string[]
  readonly callInterests: readonly RustOxcWorkerCallInterest[]
  readonly constructorNames: readonly string[]
  readonly constructorInterests: readonly RustOxcWorkerConstructorInterest[]
  readonly pruneNativeFactCallNames: readonly string[]
}

interface RustOxcWorkerCallInterest {
  readonly name: string
  readonly importFrom?: readonly string[]
}

interface RustOxcWorkerConstructorInterest {
  readonly name: string
  readonly importFrom?: readonly string[]
}

interface RustOxcWorkerFileRequest {
  readonly root: string
  readonly file: string
  readonly source?: string
  readonly readSourceFromDisk?: boolean
}

type RustOxcWorkerResponse =
  | {
      readonly id: number
      readonly ok: true
      readonly record: StaticSyntaxFileRecord
    }
  | {
      readonly id: number
      readonly ok: true
      readonly records: readonly StaticSyntaxFileRecord[]
    }
  | {
      readonly id: number
      readonly ok: false
      readonly error?: string
    }

interface PendingRequest {
  readonly resolve: (record: StaticSyntaxFileRecord | readonly StaticSyntaxFileRecord[]) => void
  readonly reject: (error: Error) => void
}

interface RustOxcWorker {
  readonly parseFile: (input: Omit<RustOxcWorkerRequest, 'id'>) => Promise<StaticSyntaxFileRecord>
  readonly parseFiles: (input: Omit<RustOxcWorkerBatchRequest, 'id'>) => Promise<readonly StaticSyntaxFileRecord[]>
}

interface RustOxcWorkerState {
  child: ChildProcessWithoutNullStreams | undefined
  lines: ReadlineInterface | undefined
  nextId: number
  stderr: string
  pending: Map<number, PendingRequest>
  idleTimer: ReturnType<typeof setTimeout> | undefined
}

export interface RustOxcSyntaxFrontendTestStatus {
  readonly available: boolean
  readonly reason?: string
}

let rustOxcSyntaxFrontendTestStatusMemo: RustOxcSyntaxFrontendTestStatus | undefined

/**
 * Creates the Rust/Oxc syntax-record frontend for parity tests and devtools benchmarks.
 *
 * Production Static Index worker orchestration is supervised by Go and should not use this helper. The helper
 * exists so TypeScript tests can compare the same Rust worker output against the TypeScript
 * frontend through the compiler-owned syntax record ABI.
 */
export function createRustOxcStaticSyntaxFrontend(options: StaticSyntaxFrontendOptions = {}): StaticSyntaxFrontend {
  const callNames = [...(options.callNames ?? [])]
  const callInterests = [...(options.callInterests ?? [])]
  const constructorNames = [...(options.constructorNames ?? DEFAULT_CONSTRUCTOR_NAMES)]
  const constructorInterests = [...(options.constructorInterests ?? [])]
  const pruneNativeFactCallNames = [...(options.pruneNativeFactCallNames ?? [])]
  const readSourceFromDisk = rustOxcReadSourceFromDiskEnabled()
  const workers = createRustOxcWorkerPool(rustOxcWorkerPoolSize())
  const frontend = {
    name: 'oxc-rust' as const,
    identity: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    parseFile: async (input: StaticSyntaxFileInput) =>
      workers.parseFile({
        ...workerFileRequest(input, readSourceFromDisk),
        callNames,
        callInterests,
        constructorNames,
        constructorInterests,
        pruneNativeFactCallNames,
      }),
  } satisfies StaticSyntaxFrontend
  if (!rustOxcBatchEnabled()) return Object.freeze(frontend)
  return Object.freeze({
    ...frontend,
    parseFiles: async (inputs: readonly StaticSyntaxFileInput[]) =>
      workers.parseFiles({
        files: inputs.map((input) => workerFileRequest(input, readSourceFromDisk)),
        callNames,
        callInterests,
        constructorNames,
        constructorInterests,
        pruneNativeFactCallNames,
      }),
  })
}

/**
 * Reports whether the local process can run the real Rust/Oxc test frontend.
 *
 * The regular TypeScript test matrix may run on machines whose Rust toolchain is older than Oxc's
 * MSRV. Tests that need the real worker should skip from this status instead of failing while Cargo
 * is resolving the Rust dependency graph.
 */
export function rustOxcSyntaxFrontendTestStatus(): RustOxcSyntaxFrontendTestStatus {
  if (rustOxcSyntaxFrontendTestStatusMemo) return rustOxcSyntaxFrontendTestStatusMemo
  rustOxcSyntaxFrontendTestStatusMemo = detectRustOxcSyntaxFrontendTestStatus()
  return rustOxcSyntaxFrontendTestStatusMemo
}

function createRustOxcWorkerPool(size: number): RustOxcWorker {
  const workers = Array.from({ length: size }, () => createRustOxcWorker())
  let nextWorker = 0
  return {
    parseFile: async (input) => {
      const worker = workers[nextWorker]
      nextWorker = (nextWorker + 1) % workers.length
      return worker.parseFile(input)
    },
    parseFiles: async (input) => workers[0].parseFiles(input),
  }
}

function createRustOxcWorker(): RustOxcWorker {
  const state: RustOxcWorkerState = {
    child: undefined,
    lines: undefined,
    nextId: 1,
    stderr: '',
    pending: new Map(),
    idleTimer: undefined,
  }
  return {
    parseFile: async (input) => sendRequest<StaticSyntaxFileRecord>(state, input),
    parseFiles: async (input) => sendRequest<readonly StaticSyntaxFileRecord[]>(state, input),
  }
}

async function sendRequest<T extends StaticSyntaxFileRecord | readonly StaticSyntaxFileRecord[]>(
  state: RustOxcWorkerState,
  input: Omit<RustOxcWorkerRequest, 'id'> | Omit<RustOxcWorkerBatchRequest, 'id'>,
): Promise<T> {
  const child = ensureWorkerStarted(state)
  const id = state.nextId
  state.nextId += 1
  const request = { id, ...input }
  clearIdleTimer(state)
  return await new Promise<T>((resolve, reject) => {
    state.pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    })
    child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (!error) return
      state.pending.delete(id)
      reject(error)
    })
  })
}

function ensureWorkerStarted(state: RustOxcWorkerState): ChildProcessWithoutNullStreams {
  if (state.child && !state.child.killed) return state.child
  const command = workerCommand()
  const child = spawn(command.bin, command.args, {
    cwd: INDEXER_PACKAGE_ROOT,
    stdio: 'pipe',
  })
  state.child = child
  state.stderr = ''
  state.lines = createInterface({ input: child.stdout })
  state.lines.on('line', (line) => handleWorkerLine(state, line))
  child.stderr.on('data', (chunk: Buffer) => {
    state.stderr = `${state.stderr}${chunk.toString('utf8')}`.slice(-4_000)
  })
  child.on('error', (error) => rejectAll(state, error))
  child.on('exit', (code, signal) => {
    rejectAll(
      state,
      new Error(`Rust/Oxc indexer worker exited code=${code ?? 'null'} signal=${signal ?? 'null'} ${state.stderr}`),
    )
    state.child = undefined
    state.lines?.close()
    state.lines = undefined
  })
  return child
}

function handleWorkerLine(state: RustOxcWorkerState, line: string): void {
  let response: RustOxcWorkerResponse
  try {
    response = JSON.parse(line) as RustOxcWorkerResponse
  } catch (error) {
    rejectAll(state, new Error(`Invalid Rust/Oxc indexer worker response: ${errorMessage(error)}`))
    return
  }
  const pending = state.pending.get(response.id)
  if (!pending) return
  state.pending.delete(response.id)
  if (response.ok && 'record' in response) {
    pending.resolve(response.record)
  } else if (response.ok && 'records' in response) {
    pending.resolve(response.records)
  } else {
    pending.reject(new Error(response.error ?? 'Rust/Oxc indexer worker failed'))
  }
  scheduleIdleShutdown(state)
}

function scheduleIdleShutdown(state: RustOxcWorkerState): void {
  if (state.pending.size > 0) return
  clearIdleTimer(state)
  const idleTimer = setTimeout(() => disposeWorker(state), 1_000)
  ;(idleTimer as { unref?: () => void }).unref?.()
  state.idleTimer = idleTimer
}

function clearIdleTimer(state: RustOxcWorkerState): void {
  if (!state.idleTimer) return
  clearTimeout(state.idleTimer)
  state.idleTimer = undefined
}

function rejectAll(state: RustOxcWorkerState, error: Error): void {
  for (const pending of state.pending.values()) pending.reject(error)
  state.pending.clear()
}

function disposeWorker(state: RustOxcWorkerState): void {
  clearIdleTimer(state)
  state.lines?.close()
  state.lines = undefined
  state.child?.kill()
  state.child = undefined
}

function workerCommand(): { readonly bin: string; readonly args: readonly string[] } {
  const explicitWorker = workerEnvValue('CRUX_STATIC_INDEX_WORKER')
  if (explicitWorker.value) return { bin: explicitWorker.value, args: ['serve'] }
  const status = rustOxcSyntaxFrontendTestStatus()
  if (!status.available) {
    throw new Error(`Rust/Oxc indexer worker test helper is unavailable: ${status.reason ?? 'unknown reason'}`)
  }
  return {
    bin: 'cargo',
    args: [
      'run',
      '--quiet',
      '--manifest-path',
      WORKSPACE_MANIFEST,
      '--package',
      'crux-indexer-worker',
      '--bin',
      'crux-indexer-worker',
      '--',
      'serve',
    ],
  }
}

function rustOxcWorkerPoolSize(): number {
  const explicit = workerEnvValue('CRUX_STATIC_INDEX_WORKER_POOL_SIZE')
  if (explicit.value !== undefined) {
    const value = explicit.value
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${explicit.name} must be a positive integer, received ${value}`)
    }
    return parsed
  }
  return Math.max(1, Math.min(4, availableParallelism()))
}

function rustOxcBatchEnabled(): boolean {
  return workerEnvValue('CRUX_STATIC_INDEX_WORKER_BATCH').value !== '0'
}

function rustOxcReadSourceFromDiskEnabled(): boolean {
  return workerEnvValue('CRUX_STATIC_INDEX_WORKER_READ_FILES').value === '1'
}

function workerFileRequest(input: StaticSyntaxFileInput, readSourceFromDisk: boolean): RustOxcWorkerFileRequest {
  if (readSourceFromDisk) {
    return {
      root: input.root,
      file: input.file,
      readSourceFromDisk: true,
    }
  }
  return input
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function detectRustOxcSyntaxFrontendTestStatus(): RustOxcSyntaxFrontendTestStatus {
  if (rustOxcTestsSkippedByEnv()) {
    return { available: false, reason: 'CRUX_INDEXER_SKIP_RUST_OXC_TESTS is enabled' }
  }
  if (workerEnvValue('CRUX_STATIC_INDEX_WORKER').value) return { available: true }
  const cargo = commandOutput('cargo', ['--version'])
  if (!cargo.ok) return { available: false, reason: cargo.reason }
  const rustc = commandOutput('rustc', ['--version'])
  if (!rustc.ok) return { available: false, reason: rustc.reason }
  const version = parseRustcVersion(rustc.output)
  if (!version) return { available: false, reason: `could not parse rustc version from "${rustc.output.trim()}"` }
  if (compareVersion(version, MIN_RUSTC_VERSION) < 0) {
    return {
      available: false,
      reason: `rustc ${formatVersion(version)} is installed; Rust/Oxc tests require rustc ${formatVersion(MIN_RUSTC_VERSION)} or newer`,
    }
  }
  return { available: true }
}

function commandOutput(
  command: string,
  args: readonly string[],
): { readonly ok: true; readonly output: string } | { readonly ok: false; readonly reason: string } {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  if (result.error) return { ok: false, reason: `${command} is unavailable: ${result.error.message}` }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `${command} ${args.join(' ')} exited with ${result.status ?? 'unknown'}: ${result.stderr || result.stdout}`,
    }
  }
  return { ok: true, output: result.stdout.trim() }
}

function parseRustcVersion(output: string): readonly [number, number, number] | undefined {
  const match = /^rustc\s+(\d+)\.(\d+)\.(\d+)/.exec(output.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

function compareVersion(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function formatVersion(version: readonly [number, number, number]): string {
  return version.join('.')
}

function rustOxcTestsSkippedByEnv(): boolean {
  const value = process.env.CRUX_INDEXER_SKIP_RUST_OXC_TESTS?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function workerEnvValue(name: string): { readonly name: string; readonly value: string | undefined } {
  const value = process.env[name]?.trim()
  return { name, value: value || undefined }
}
