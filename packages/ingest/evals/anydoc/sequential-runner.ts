import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { ANydocFixtureResourceCeilings } from './fixture-manifest.js'

export type ParserRunFailure =
  | 'containment-unavailable'
  | 'expanded-too-large'
  | 'invalid-result'
  | 'memory-limit'
  | 'result-too-large'
  | 'source-too-large'
  | 'stderr-too-large'
  | 'stdout-too-large'
  | 'timeout'
  | 'worker-crash'

export interface SandboxCapability {
  readonly version: 1
  readonly verifiedBy: 'host-supervisor'
  readonly filesystem: { readonly read: 'input-only'; readonly write: 'private-temp-only' }
  readonly outboundNetwork: 'denied'
  readonly privilegeEscalation: 'denied'
}

export interface HostCapability {
  readonly hardMemoryContainment: boolean
  readonly sandbox?: SandboxCapability
}

export interface ParserWorkerSuccess {
  readonly kind: 'success'
  readonly native: unknown
  readonly core: unknown
  readonly diagnostics?: readonly string[]
  readonly assets?: readonly { readonly byteLength: number }[]
  /** An adapter may report expansion after decoding; the parent never guesses it. */
  readonly expandedBytes?: number
}

export type ParserResourceLimits = { readonly [Key in keyof typeof ANydocFixtureResourceCeilings]: number }

export interface ParserRunOptions {
  readonly workerPath: string
  readonly source: string | URL
  readonly workerArguments?: readonly string[]
  readonly limits?: Partial<ParserResourceLimits>
  readonly hostCapability?: HostCapability
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
    readonly rssMeasurement: 'linux-procfs-process-group' | 'unsupported'
    readonly productionEquivalent: boolean
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

/**
 * Runs exactly one fresh eval worker. This is deliberately not a production
 * sandbox: production equivalence is only recorded for host-verified memory
 * containment plus the separately verified sandbox capability.
 */
export async function runParserCandidate(options: ParserRunOptions): Promise<ParserRunResult> {
  return runSerially(() => runOneParserCandidate(options))
}

async function runOneParserCandidate(options: ParserRunOptions): Promise<ParserRunResult> {
  const limits: ParserResourceLimits = { ...ANydocFixtureResourceCeilings, ...options.limits }
  const startedAt = Date.now()
  const sourcePath = sourcePathOf(options.source)
  const productionEquivalent = hasProductionEquivalentCapability(options.hostCapability)
  if (options.requireProductionEquivalent && !productionEquivalent) {
    return completedFailure('containment-unavailable', startedAt, 0, false, undefined, options.cleanupPaths)
  }

  let sourceBytes: number
  try {
    sourceBytes = (await fs.stat(sourcePath)).size
  } catch {
    return completedFailure('worker-crash', startedAt, 0, false, undefined, options.cleanupPaths)
  }
  if (sourceBytes > limits.sourceBytes) {
    return completedFailure('source-too-large', startedAt, 0, false, sourceBytes, options.cleanupPaths)
  }

  const child = spawn(process.execPath, [options.workerPath, ...(options.workerArguments ?? [])], {
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  })
  const source = createReadStream(sourcePath, { start: 0, end: Math.max(0, sourceBytes - 1) })
  source.pipe(child.stdin)

  let peakRssBytes: number | undefined
  let memoryLimitHit = false
  const sample = async (): Promise<void> => {
    const rss = await processGroupRss(child.pid)
    if (rss !== undefined) {
      peakRssBytes = Math.max(peakRssBytes ?? 0, rss)
      if (rss > limits.peakRssBytes) {
        memoryLimitHit = true
        terminateThenKill(child)
      }
    }
  }
  await sample()
  const rssTimer = setInterval(() => { void sample() }, 25)

  const settled = await awaitWorker(child, limits, startedAt)
  clearInterval(rssTimer)
  await sample()
  source.destroy()
  await cleanup(options.cleanupPaths)

  const base = {
    sourceBytes,
    wallMilliseconds: Date.now() - startedAt,
    ...(peakRssBytes === undefined ? {} : { peakRssBytes }),
    rssMeasurement: process.platform === 'linux' ? 'linux-procfs-process-group' as const : 'unsupported' as const,
    productionEquivalent,
    maxConcurrentChildren: 1 as const,
    cleanedUp: true,
  }
  if (memoryLimitHit || settled.failure !== undefined) {
    return { outcome: { kind: 'failure', error: memoryLimitHit ? 'memory-limit' : settled.failure! }, hashes: {}, diagnostics: settled.diagnostics, metadata: base }
  }
  const validation = validateWorkerResult(settled.value, limits)
  if (validation.failure !== undefined) {
    return { outcome: { kind: 'failure', error: validation.failure }, hashes: {}, diagnostics: [], metadata: base }
  }
  return {
    outcome: { kind: 'success' },
    hashes: { native: canonicalHash(validation.value.native), core: canonicalHash(validation.value.core) },
    diagnostics: validation.value.diagnostics ?? [],
    metadata: base,
  }
}

function runSerially<Result>(operation: () => Promise<Result>): Promise<Result> {
  const next = serialTail.then(operation, operation)
  serialTail = next.then(() => undefined, () => undefined)
  return next
}

/** Runs admission samples in strict sequence: three cold, then five warm. */
export async function collectDeterminismEvidence(options: ParserRunOptions): Promise<DeterminismEvidence> {
  const cold: ParserRunResult[] = []
  const warm: ParserRunResult[] = []
  for (let index = 0; index < 3; index += 1) {
    cold.push(await runParserCandidate(options))
  }
  for (let index = 0; index < 5; index += 1) {
    warm.push(await runParserCandidate(options))
  }
  const successful = [...cold, ...warm].filter((run) => run.outcome.kind === 'success')
  const first = successful[0]?.hashes
  const deterministic = successful.length === 8
    && first !== undefined
    && successful.every((run) => run.hashes.native === first.native && run.hashes.core === first.core)
  return { cold, warm, deterministic, hashes: deterministic ? first : {} }
}

async function awaitWorker(child: ReturnType<typeof spawn>, limits: ParserResourceLimits, startedAt: number): Promise<{ readonly value?: unknown; readonly failure?: ParserRunFailure; readonly diagnostics: readonly string[] }> {
  return new Promise((resolve) => {
    let finished = false
    let failure: ParserRunFailure | undefined
    let value: unknown
    let frame = Buffer.alloc(0)
    let expectedLength: number | undefined
    const diagnostics: string[] = []
    const finish = (nextFailure?: ParserRunFailure, alreadyReaped = false): void => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timeout)
      if (nextFailure !== undefined) {
        terminateThenKill(child)
        if (!alreadyReaped) {
          child.once('close', () => resolve({ value, failure: nextFailure ?? failure, diagnostics }))
          return
        }
      }
      resolve({ value, failure: nextFailure ?? failure, diagnostics })
    }
    const timeout = setTimeout(() => finish('timeout'), limits.wallMilliseconds)
    child.on('error', () => finish('worker-crash'))
    child.on('close', (code) => {
      if (expectedLength !== undefined && frame.length === expectedLength && failure === undefined) {
        finish(undefined, true)
      } else {
        finish(code === 0 ? 'invalid-result' : 'worker-crash', true)
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      const received = diagnostics.reduce((total, entry) => total + Buffer.byteLength(entry), 0) + chunk.byteLength
      if (received > limits.stderrBytes) {
        finish('stderr-too-large')
        return
      }
      diagnostics.push(decoder.decode(chunk))
    })
    let stdoutBytes = 0
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > limits.stdoutBytes) {
        finish('stdout-too-large')
      }
    })
    const ipc = child.stdio[3] as Readable
    ipc.on('data', (chunk: Buffer) => {
      if (finished) {
        return
      }
      frame = Buffer.concat([frame, chunk])
      if (expectedLength === undefined && frame.length >= 4) {
        expectedLength = frame.readUInt32BE(0)
        frame = frame.subarray(4)
        if (expectedLength > limits.resultBytes) {
          failure = 'result-too-large'
          finish(failure)
          return
        }
      }
      if (expectedLength !== undefined && frame.length > expectedLength) {
        finish('invalid-result')
      }
    })
    ipc.on('end', () => {
      if (expectedLength === undefined || frame.length !== expectedLength) {
        return
      }
      try {
        value = JSON.parse(decoder.decode(frame))
      } catch {
        finish('invalid-result')
      }
    })
    void startedAt
  })
}

function validateWorkerResult(value: unknown, limits: ParserResourceLimits): { readonly value: ParserWorkerSuccess; readonly failure?: undefined } | { readonly failure: ParserRunFailure } {
  if (!isRecord(value) || value.kind !== 'success' || !('native' in value) || !('core' in value)) {
    return { failure: 'invalid-result' }
  }
  try {
    canonicalJson(value.native)
    canonicalJson(value.core)
  } catch {
    return { failure: 'invalid-result' }
  }
  if (value.expandedBytes !== undefined && (!isBoundedInteger(value.expandedBytes) || value.expandedBytes > limits.expandedBytes)) {
    return { failure: 'expanded-too-large' }
  }
  if (value.diagnostics !== undefined && (!Array.isArray(value.diagnostics) || !value.diagnostics.every((entry) => typeof entry === 'string'))) {
    return { failure: 'invalid-result' }
  }
  if (value.assets !== undefined && (!Array.isArray(value.assets) || value.assets.length > limits.assetCount || !value.assets.every((asset) => isRecord(asset) && isBoundedInteger(asset.byteLength)))) {
    return { failure: 'invalid-result' }
  }
  const assets = value.assets as readonly { readonly byteLength: number }[] | undefined
  if (assets !== undefined && assets.reduce((total, asset) => total + asset.byteLength, 0) > limits.assetBytes) {
    return { failure: 'invalid-result' }
  }
  return { value: value as unknown as ParserWorkerSuccess }
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new TypeError('Parser output must be JSON serializable.')
}

function terminateThenKill(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return
  }
  const signal = (value: NodeJS.Signals): void => {
    try {
      if (process.platform === 'win32') {
        child.kill(value)
      } else {
        process.kill(-child.pid!, value)
      }
    } catch {}
  }
  signal('SIGTERM')
  setTimeout(() => signal('SIGKILL'), 50).unref()
}

async function processGroupRss(pid: number | undefined): Promise<number | undefined> {
  if (pid === undefined || process.platform !== 'linux') {
    return undefined
  }
  try {
    const entries = await fs.readdir('/proc')
    const rss = await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(async (entry) => {
      const stat = await fs.readFile(`/proc/${entry}/stat`, 'utf8').catch(() => undefined)
      if (stat === undefined || stat.split(' ')[4] !== String(pid)) {
        return 0
      }
      const status = await fs.readFile(`/proc/${entry}/status`, 'utf8').catch(() => undefined)
      const kb = /^VmRSS:\s+(\d+) kB$/m.exec(status ?? '')?.[1]
      return kb === undefined ? 0 : Number(kb) * 1024
    }))
    return rss.reduce((total, value) => total + value, 0)
  } catch {
    return undefined
  }
}

async function cleanup(paths: readonly string[] | undefined): Promise<void> {
  await Promise.all((paths ?? []).map(async (path) => {
    if (dirname(path) !== path) {
      await fs.rm(path, { recursive: true, force: true })
    }
  }))
}

async function completedFailure(error: ParserRunFailure, startedAt: number, maxConcurrentChildren: 0 | 1, productionEquivalent: boolean, sourceBytes: number | undefined, cleanupPaths: readonly string[] | undefined): Promise<ParserRunResult> {
  await cleanup(cleanupPaths)
  return {
    outcome: { kind: 'failure', error }, hashes: {}, diagnostics: [],
    metadata: { ...(sourceBytes === undefined ? {} : { sourceBytes }), wallMilliseconds: Date.now() - startedAt, rssMeasurement: process.platform === 'linux' ? 'linux-procfs-process-group' : 'unsupported', productionEquivalent, maxConcurrentChildren, cleanedUp: true },
  }
}

function hasProductionEquivalentCapability(capability: HostCapability | undefined): boolean {
  const sandbox = capability?.sandbox
  return capability?.hardMemoryContainment === true
    && sandbox?.version === 1
    && sandbox.verifiedBy === 'host-supervisor'
    && sandbox.filesystem.read === 'input-only'
    && sandbox.filesystem.write === 'private-temp-only'
    && sandbox.outboundNetwork === 'denied'
    && sandbox.privilegeEscalation === 'denied'
}

function sourcePathOf(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
