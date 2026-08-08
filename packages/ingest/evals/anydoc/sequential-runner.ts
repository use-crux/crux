import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { ANydocFixtureResourceCeilings } from './fixture-manifest.js'

export type ParserRunFailure =
  | 'containment-unavailable' | 'cpu-limit' | 'expanded-too-large' | 'invalid-limit'
  | 'invalid-result' | 'memory-limit' | 'cleanup-failed' | 'result-too-large' | 'source-too-large'
  | 'stderr-too-large' | 'stdout-too-large' | 'timeout' | 'worker-crash'

export type ParserResourceLimits = { readonly [Key in keyof typeof ANydocFixtureResourceCeilings]: number }

/** The FD 3 frame is length-prefixed JSON. Adapters count decoded output before returning it. */
export interface ParserWorkerSuccess {
  readonly kind: 'success'
  readonly native: { readonly diagnostics: readonly string[]; readonly assets: readonly { readonly byteLength: number }[]; readonly value: unknown }
  readonly core: { readonly diagnostics: readonly string[]; readonly assets: readonly { readonly byteLength: number }[]; readonly value: unknown }
  readonly expandedBytes: number
  readonly diagnostics: { readonly count: number; readonly byteLength: number }
  readonly assets: { readonly count: number; readonly byteLength: number }
}

export interface ParserRunOptions {
  readonly workerPath: string
  readonly source: string | URL
  readonly workerArguments?: readonly string[]
  readonly limits?: Partial<ParserResourceLimits>
  readonly requireProductionEquivalent?: boolean
  readonly cleanupPaths?: readonly string[]
}

export interface ParserRunResult {
  readonly outcome: { readonly kind: 'success' } | { readonly kind: 'failure'; readonly error: ParserRunFailure }
  readonly hashes: { readonly native?: string; readonly core?: string }
  readonly diagnostics: readonly string[]
  readonly metadata: {
    readonly sourceBytes?: number
    readonly wallMilliseconds: number
    readonly peakRssBytes?: number
    readonly cpuMilliseconds?: number
    readonly workerPid?: number
    readonly rssMeasurement: 'linux-procfs-process-group' | 'unsupported'
    readonly productionEquivalent: false
    readonly maxConcurrentChildren: 0 | 1
    readonly cleanedUp: boolean
  }
}

export interface DeterminismEvidence {
  readonly cold: readonly ParserRunResult[]
  readonly warm: readonly ParserRunResult[]
  readonly deterministic: boolean
  readonly hashes: { readonly native?: string; readonly core?: string }
}

const decoder = new TextDecoder()
let serialTail: Promise<void> = Promise.resolve()
let clockTicks: Promise<number | undefined> | undefined

/** Eval-only local evidence. It never claims production containment. */
export function runParserCandidate(options: ParserRunOptions): Promise<ParserRunResult> {
  return runSerially(() => runOne(options))
}

async function runOne(options: ParserRunOptions): Promise<ParserRunResult> {
  const startedAt = Date.now()
  const limits = resolveLimits(options.limits)
  if (limits === undefined) return failure('invalid-limit', startedAt, 0, undefined, options.cleanupPaths)
  // Node cannot provide equivalent process-tree containment on macOS/Windows.
  if (process.platform !== 'linux' || options.requireProductionEquivalent) {
    return failure('containment-unavailable', startedAt, 0, undefined, options.cleanupPaths)
  }
  const ticks = await linuxClockTicks().catch(() => undefined)
  if (ticks === undefined) return failure('containment-unavailable', startedAt, 0, undefined, options.cleanupPaths)

  const sourcePath = sourcePathOf(options.source)
  let sourceBytes: number
  try {
    const stat = await fs.stat(sourcePath)
    if (!stat.isFile()) return failure('invalid-result', startedAt, 0, undefined, options.cleanupPaths)
    sourceBytes = stat.size
  } catch {
    return failure('worker-crash', startedAt, 0, undefined, options.cleanupPaths)
  }
  if (sourceBytes > limits.sourceBytes) return failure('source-too-large', startedAt, 0, sourceBytes, options.cleanupPaths)

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(process.execPath, [options.workerPath, ...(options.workerArguments ?? [])], {
      detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    })
  } catch {
    return failure('worker-crash', startedAt, 0, sourceBytes, options.cleanupPaths)
  }
  const source = createReadStream(sourcePath, { start: 0, end: Math.max(0, sourceBytes - 1) })
  source.on('error', () => child.kill('SIGTERM'))
  source.pipe(child.stdin!)
  // Attach lifecycle listeners before the first asynchronous /proc sample: a
  // tiny worker can otherwise exit before the parent observes its close event.
  const protocol = startWorkerProtocol(child, limits)
  const group = new LinuxProcessGroup(child.pid!, ticks)

  let peakRssBytes: number | undefined
  let cpuMilliseconds: number | undefined
  let resourceFailure: Extract<ParserRunFailure, 'memory-limit' | 'cpu-limit'> | undefined
  let sampling = false
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const sample = async (): Promise<void> => {
    if (sampling || stopped) return
    sampling = true
    try {
      const usage = await group.sample()
      if (usage === undefined) {
        resourceFailure = 'memory-limit'
        return
      }
      peakRssBytes = Math.max(peakRssBytes ?? 0, usage.rssBytes)
      cpuMilliseconds = Math.max(cpuMilliseconds ?? 0, usage.cpuMilliseconds)
      if (usage.rssBytes > limits.peakRssBytes) resourceFailure = 'memory-limit'
      if (usage.cpuMilliseconds > limits.cpuMilliseconds) resourceFailure = 'cpu-limit'
    } finally {
      sampling = false
      if (!stopped) timer = setTimeout(() => { void sample() }, 20)
    }
  }
  await sample()
  const settled = await protocol.ready
  stopped = true
  if (timer !== undefined) clearTimeout(timer)
  if (settled.failure === undefined) await sample()
  let protocolFailure = settled.failure ?? resourceFailure
  if (protocolFailure === undefined) {
    protocol.ack()
    const remaining = Math.max(1, limits.wallMilliseconds - (Date.now() - startedAt))
    const acknowledged = await waitFor(protocol.acknowledged, remaining)
    const closed = acknowledged === true ? await waitFor(protocol.closed, Math.max(1, limits.wallMilliseconds - (Date.now() - startedAt))) : undefined
    protocolFailure = acknowledged !== true ? 'invalid-result' : closed === undefined ? 'timeout' : closed === 0 ? undefined : 'worker-crash'
  }
  const reaped = await group.reap()
  source.destroy()
  const cleanedUp = await cleanup(options.cleanupPaths)
  const metadata = {
    sourceBytes, wallMilliseconds: Date.now() - startedAt,
    ...(peakRssBytes === undefined ? {} : { peakRssBytes }),
    ...(cpuMilliseconds === undefined ? {} : { cpuMilliseconds }),
    rssMeasurement: 'linux-procfs-process-group' as const,
    productionEquivalent: false as const, maxConcurrentChildren: 1 as const, cleanedUp,
    ...(child.pid === undefined ? {} : { workerPid: child.pid }),
  }
  if (!cleanedUp || !reaped) return { outcome: { kind: 'failure', error: 'cleanup-failed' }, hashes: {}, diagnostics: settled.diagnostics, metadata }
  const error = protocolFailure
  if (error !== undefined) return { outcome: { kind: 'failure', error }, hashes: {}, diagnostics: settled.diagnostics, metadata }
  const result = validateWorkerResult(settled.value, limits)
  if ('failure' in result) return { outcome: { kind: 'failure', error: result.failure }, hashes: {}, diagnostics: [], metadata }
  try {
    return { outcome: { kind: 'success' }, hashes: { native: hash(result.value.native), core: hash(result.value.core) }, diagnostics: result.value.native.diagnostics, metadata }
  } catch {
    return { outcome: { kind: 'failure', error: 'invalid-result' }, hashes: {}, diagnostics: [], metadata }
  }
}

/** Runs admission samples strictly in order: three fresh cold children, then five fresh warm children. */
export async function collectDeterminismEvidence(options: ParserRunOptions): Promise<DeterminismEvidence> {
  const cold: ParserRunResult[] = []
  const warm: ParserRunResult[] = []
  for (let index = 0; index < 3; index += 1) cold.push(await runParserCandidate(options))
  for (let index = 0; index < 5; index += 1) warm.push(await runParserCandidate(options))
  const all = [...cold, ...warm]
  const first = all[0]?.hashes
  const deterministic = all.length === 8 && all.every((run) => run.outcome.kind === 'success' && run.hashes.native === first?.native && run.hashes.core === first?.core)
  return { cold, warm, deterministic, hashes: deterministic ? first! : {} }
}

function runSerially<Result>(operation: () => Promise<Result>): Promise<Result> {
  const next = serialTail.then(operation, operation)
  serialTail = next.then(() => undefined, () => undefined)
  return next
}

function startWorkerProtocol(child: ReturnType<typeof spawn>, limits: ParserResourceLimits): { readonly ready: Promise<{ readonly value?: unknown; readonly failure?: ParserRunFailure; readonly diagnostics: readonly string[] }>; readonly closed: Promise<number | undefined>; readonly acknowledged: Promise<boolean>; readonly ack: () => void } {
  let resolveClosed: (code: number | undefined) => void = () => undefined
  const closed = new Promise<number | undefined>((resolve) => { resolveClosed = resolve })
  let resolveAcknowledged: (value: boolean) => void = () => undefined
  const acknowledged = new Promise<boolean>((resolve) => { resolveAcknowledged = resolve })
  const ready = new Promise<{ readonly value?: unknown; readonly failure?: ParserRunFailure; readonly diagnostics: readonly string[] }>((resolve) => {
    let finished = false
    let stdoutBytes = 0
    let stderrBytes = 0
    const diagnostics: string[] = []
    const reader = new BoundedFrameReader(limits.resultBytes)
    const complete = (failure?: ParserRunFailure, reaped = false): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({ ...(failure === undefined ? { value: reader.value() } : {}), ...(failure === undefined ? {} : { failure }), diagnostics })
    }
    const timeout = setTimeout(() => complete('timeout'), limits.wallMilliseconds)
    child.on('error', () => complete('worker-crash'))
    child.on('close', (code) => {
      resolveClosed(code ?? undefined)
      complete(code === 0 && reader.complete() ? 'invalid-result' : 'worker-crash', true)
    })
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > limits.stdoutBytes) complete('stdout-too-large')
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > limits.stderrBytes) complete('stderr-too-large')
      else diagnostics.push(decoder.decode(chunk))
    })
    ;(child.stdio[3] as Readable).on('data', (chunk: Buffer) => {
      const error = reader.push(chunk)
      if (error !== undefined) complete(error)
    })
    ;(child.stdio[3] as Readable).on('end', () => {
      if (reader.complete()) complete()
      else if (reader.hasFrame()) complete('invalid-result')
    })
    ;(child.stdio[4] as Readable).on('data', (chunk: Buffer) => {
      if (chunk.toString() === 'ACKED\n') resolveAcknowledged(true)
    })
    ;(child.stdio[4] as Readable).on('end', () => resolveAcknowledged(false))
  })
  return { ready, closed, acknowledged, ack: () => { try { (child.stdio[4] as NodeJS.WritableStream).write('ACK\n') } catch {} } }
}

async function waitFor<Value>(promise: Promise<Value>, milliseconds: number): Promise<Value | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<undefined>((resolve) => { timer = setTimeout(resolve, milliseconds) as unknown as ReturnType<typeof setTimeout> })]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

class BoundedFrameReader {
  private readonly header = Buffer.allocUnsafe(4)
  private headerBytes = 0
  private body: Buffer | undefined
  private bodyBytes = 0
  private invalid = false
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): ParserRunFailure | undefined {
    let offset = 0
    if (this.headerBytes < 4) {
      const size = Math.min(4 - this.headerBytes, chunk.byteLength)
      chunk.copy(this.header, this.headerBytes, 0, size)
      this.headerBytes += size
      offset += size
      if (this.headerBytes === 4) {
        const length = this.header.readUInt32BE(0)
        if (length > this.limit) return 'result-too-large'
        this.body = Buffer.allocUnsafe(length)
      }
    }
    if (this.body !== undefined && offset < chunk.byteLength) {
      const size = chunk.byteLength - offset
      if (this.bodyBytes + size > this.body.byteLength) return 'invalid-result'
      chunk.copy(this.body, this.bodyBytes, offset)
      this.bodyBytes += size
    }
    return undefined
  }
  complete(): boolean { return !this.invalid && this.body !== undefined && this.bodyBytes === this.body.byteLength }
  hasFrame(): boolean { return this.headerBytes > 0 }
  value(): unknown {
    if (!this.complete()) return undefined
    try { return JSON.parse(decoder.decode(this.body!)) } catch { return undefined }
  }
}

function validateWorkerResult(value: unknown, limits: ParserResourceLimits): { readonly value: ParserWorkerSuccess } | { readonly failure: ParserRunFailure } {
  if (!isRecord(value) || value.kind !== 'success' || !isSuccessPayload(value.native) || !isSuccessPayload(value.core) || !isBoundedInteger(value.expandedBytes) || !isCount(value.diagnostics) || !isCount(value.assets)) return { failure: 'invalid-result' }
  const native = value.native
  const core = value.core
  const diagnosticsBytes = byteLength(native.diagnostics)
  const assetsBytes = assetBytes(native.assets)
  if (value.expandedBytes > limits.expandedBytes) return { failure: 'expanded-too-large' }
  if (!sameJson(native.diagnostics, core.diagnostics) || !sameJson(native.assets, core.assets)) return { failure: 'invalid-result' }
  if (value.diagnostics.count !== native.diagnostics.length || value.diagnostics.byteLength !== diagnosticsBytes || value.assets.count !== native.assets.length || value.assets.byteLength !== assetsBytes) return { failure: 'invalid-result' }
  if (native.assets.length > limits.assetCount || assetsBytes > limits.assetBytes) return { failure: 'invalid-result' }
  try { canonicalJson(native); canonicalJson(core) } catch { return { failure: 'invalid-result' } }
  return { value: value as unknown as ParserWorkerSuccess }
}

function isSuccessPayload(value: unknown): value is { readonly diagnostics: readonly string[]; readonly assets: readonly { readonly byteLength: number }[]; readonly value: unknown } {
  return isRecord(value) && 'value' in value && Array.isArray(value.diagnostics) && value.diagnostics.every((item) => typeof item === 'string') && Array.isArray(value.assets) && value.assets.every((item) => isRecord(item) && isBoundedInteger(item.byteLength))
}
function isCount(value: unknown): value is { readonly count: number; readonly byteLength: number } { return isRecord(value) && isBoundedInteger(value.count) && isBoundedInteger(value.byteLength) }
function byteLength(values: readonly string[]): number { return values.reduce((total, value) => total + Buffer.byteLength(value), 0) }
function assetBytes(values: readonly { readonly byteLength: number }[]): number { return values.reduce((total, value) => total + value.byteLength, 0) }
function sameJson(left: unknown, right: unknown): boolean { try { return canonicalJson(left) === canonicalJson(right) } catch { return false } }
function hash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Non-finite number'); return JSON.stringify(value) }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  throw new TypeError('Unsupported parser result value')
}

function resolveLimits(input: Partial<ParserResourceLimits> | undefined): ParserResourceLimits | undefined {
  const result = {} as Record<keyof ParserResourceLimits, number>
  for (const key of Object.keys(ANydocFixtureResourceCeilings) as (keyof ParserResourceLimits)[]) {
    const value = input?.[key] ?? ANydocFixtureResourceCeilings[key]
    if (!Number.isSafeInteger(value) || value <= 0) return undefined
    result[key] = Math.min(value, ANydocFixtureResourceCeilings[key])
  }
  return result
}

class LinuxProcessGroup {
  private readonly members = new Map<number, number>()
  private live = new Map<number, number>()
  constructor(private readonly pgid: number, private readonly ticks: number) {}
  async sample(): Promise<{ readonly rssBytes: number; readonly cpuMilliseconds: number } | undefined> {
    try {
      let rssBytes = 0
      let cpuTicks = 0
      this.live = new Map()
      for (const entry of await fs.readdir('/proc')) {
        if (!/^\d+$/.test(entry)) continue
        const pid = Number(entry)
        const stat = parseLinuxStat(await fs.readFile(`/proc/${entry}/stat`, 'utf8').catch(() => ''))
        if (stat?.pgrp !== this.pgid) continue
        this.members.set(pid, stat.starttime)
        this.live.set(pid, stat.starttime)
        const status = await fs.readFile(`/proc/${entry}/status`, 'utf8').catch(() => '')
        rssBytes += Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1] ?? 0) * 1024
        cpuTicks += stat.utime + stat.stime
      }
      return { rssBytes, cpuMilliseconds: Math.floor(cpuTicks * 1_000 / this.ticks) }
    } catch { return undefined }
  }
  async reap(): Promise<boolean> {
    await this.sample()
    await this.signal('SIGTERM')
    if (await this.emptyAfter(60)) return true
    await this.signal('SIGKILL')
    return this.emptyAfter(120)
  }
  private async signal(signal: NodeJS.Signals): Promise<void> {
    for (const [pid, starttime] of this.members) {
      const stat = parseLinuxStat(await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => ''))
      if (stat?.starttime !== starttime) continue
      try { process.kill(pid, signal) } catch {}
    }
  }
  private async emptyAfter(milliseconds: number): Promise<boolean> {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const usage = await this.sample()
      if (usage !== undefined && this.groupIsEmpty()) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await this.sample()
    return this.groupIsEmpty()
  }
  private groupIsEmpty(): boolean {
    return this.live.size === 0
  }
}

function parseLinuxStat(value: string): { readonly pgrp: number; readonly utime: number; readonly stime: number; readonly starttime: number } | undefined {
  const close = value.lastIndexOf(')')
  if (close < 0) return undefined
  const fields = value.slice(close + 1).trim().split(/\s+/)
  const pgrp = Number(fields[2]); const utime = Number(fields[11]); const stime = Number(fields[12]); const starttime = Number(fields[19])
  return [pgrp, utime, stime, starttime].every(Number.isFinite) ? { pgrp, utime, stime, starttime } : undefined
}
function linuxClockTicks(): Promise<number | undefined> {
  clockTicks ??= new Promise((resolve) => execFile('getconf', ['CLK_TCK'], (error, stdout) => {
    const value = error ? NaN : Number(stdout.trim())
    resolve(Number.isSafeInteger(value) && value > 0 ? value : undefined)
  }))
  return clockTicks
}
async function cleanup(paths: readonly string[] | undefined): Promise<boolean> { try { await Promise.all((paths ?? []).map((path) => dirname(path) === path ? undefined : fs.rm(path, { recursive: true, force: true }))); return true } catch { return false } }
async function failure(error: ParserRunFailure, startedAt: number, maxConcurrentChildren: 0 | 1, sourceBytes: number | undefined, paths: readonly string[] | undefined): Promise<ParserRunResult> {
  const cleanedUp = await cleanup(paths)
  return { outcome: { kind: 'failure', error }, hashes: {}, diagnostics: [], metadata: { ...(sourceBytes === undefined ? {} : { sourceBytes }), wallMilliseconds: Date.now() - startedAt, rssMeasurement: process.platform === 'linux' ? 'linux-procfs-process-group' : 'unsupported', productionEquivalent: false, maxConcurrentChildren, cleanedUp } }
}
function sourcePathOf(source: string | URL): string { return source instanceof URL ? fileURLToPath(source) : source }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isBoundedInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
