import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { Socket } from 'node:net'
import type { Format as NativeFormat } from '@firecrawl/anydoc'
import { admitAnydocDocument, AnydocAdmissionError } from '../../ingest/private/anydoc-admission.mjs'
import { encodeAdmissionResult, preflightAndProjectRawDocument } from '../lib/anydoc-raw-result'

const protocolVersion = 2
const maxSourceBytes = 32 << 20
const maxResultBytes = 8 << 20
const maxExpandedBytes = 256 << 20
const maxAssetCount = 128
const maxAssetBytes = 64 << 20
const maxDiagnosticBytes = 64 << 10
const maxMemoryBytes = 512 << 20
const maxCpuMilliseconds = 20_000
const maxWallMilliseconds = 30_000
const maxPids = 64
const inputPath = '/run/crux-anydoc/input/source'
const timeoutMilliseconds = 25_000
const parserFormats = new Set<AnydocFormat>(['doc', 'docm', 'docx', 'rtf', 'odt', 'epub', 'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm', 'odp', 'xls', 'xlsb', 'xlsx', 'xlsm', 'ods', 'csv', 'pdf'])

type AnydocFormat = 'doc' | 'docm' | 'docx' | 'rtf' | 'odt' | 'epub' | 'ppt' | 'pps' | 'pot' | 'pptx' | 'pptm' | 'ppsx' | 'ppsm' | 'odp' | 'xls' | 'xlsb' | 'xlsx' | 'xlsm' | 'ods' | 'csv' | 'pdf'
type ParserError = 'invalid-result' | 'encrypted' | 'expanded-too-large' | 'unsupported-format'
type JobLimits = { sourceBytes: number; resultBytes: number; expandedBytes: number; assetCount: number; assetBytes: number; diagnosticBytes: number; memoryBytes: number; cpuMilliseconds: number; wallMilliseconds: number; pids: number }
type Accounting = { sourceBytes: number; rawBytes: number; expandedBytes: number; assetCount: number; assetBytes: number; diagnosticCount: number; diagnosticBytes: number }
type Request = { version: number; nonce: string; requestDigest: string; format: AnydocFormat; sourceSha256: string; sourceBytes: number; limits: JobLimits }
type Result = (Request & { ok: true; payload: string; accounting: Accounting }) | (Request & { ok: false; failureKind: 'parser'; error: ParserError })

const [capabilityPath, resultPath] = process.argv.slice(2)

void main()

async function main(): Promise<void> {
  if (!capabilityPath || !resultPath) return abort()
  const request = await receiveRequest(capabilityPath).catch(() => undefined)
  if (!validRequest(request)) return abort()

  const bytes = await readSource(inputPath, request.limits.sourceBytes).catch(() => undefined)
  if (!bytes) return abort()
  if (bytes.byteLength !== request.sourceBytes || sha256(bytes) !== request.sourceSha256) return abort()
  if (request.format === 'pdf') return fail('unsupported-format', request)

  let payload: unknown
  try {
    // This literal is intentionally post-capability: the bundled runner's
    // top level has only Node builtins, so untrusted launches cannot load the
    // native addon before proving possession of this run's nonce and digest.
    const anydoc = await import('@firecrawl/anydoc')
    payload = await anydoc.toDocument(bytes, nativeFormat(request.format))
  } catch (error) {
    return fail(parserError(error), request)
  }
  let projected
  try {
    projected = preflightAndProjectRawDocument(
      payload,
      request.limits,
      (document) => admitAnydocDocument(document, bytes, request.format, request.limits),
    )
  } catch (error) {
    return fail(error instanceof AnydocAdmissionError ? error.code : 'invalid-result', request)
  }
  if ('error' in projected) return fail(projected.error, request)
  const { admission } = projected
  const preflight = projected
  const projection = Buffer.from(JSON.stringify({ native: admission.native, core: admission.core }))
  const expandedBytes = bytes.byteLength + projection.byteLength + preflight.assetBytes
  if (expandedBytes > request.limits.expandedBytes) return fail('expanded-too-large', request)
  const accounting: Accounting = {
    sourceBytes: bytes.byteLength,
    rawBytes: projection.byteLength,
    expandedBytes,
    assetCount: preflight.assets.length,
    assetBytes: preflight.assetBytes,
    diagnosticCount: 0,
    diagnosticBytes: 0,
  }
  const encoded = encodeAdmissionResult({ resultBytes: request.limits.resultBytes, sourceBytes: request.sourceBytes }, admission, projection.byteLength, preflight.assets, accounting)
  if ('error' in encoded) return fail(encoded.error, request)
  const result = { ...request, ok: true as const, payload: encoded.bytes.toString('base64'), accounting }
  if (encodeResult(result).byteLength > request.limits.resultBytes) return fail('invalid-result', request)
  await send(result)
}

async function receiveRequest(path: string): Promise<Request> {
  const socket = await connectWhenAuthorized(path)
  try { return await withTimeout(readFrame<Request>(socket), socket) } finally { socket.destroy() }
}

async function connectWhenAuthorized(path: string): Promise<Socket> {
  const deadline = Date.now() + timeoutMilliseconds
  for (;;) {
    try {
      return await connect(path)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || (error.code !== 'EACCES' && error.code !== 'ENOENT') || Date.now() >= deadline) throw error
      await delay(10)
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readSource(path: string, limit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxSourceBytes) throw new Error('source')
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size < 0 || stat.size > limit) throw new Error('source')
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 << 10, limit + 1 - total))
      const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) return Buffer.concat(chunks, total)
      total += bytesRead
      if (total > limit) throw new Error('source')
      chunks.push(chunk.subarray(0, bytesRead))
    }
  } finally { await file.close() }
}

function validRequest(value: unknown): value is Request {
  return isRecord(value) && exactKeys(value, ['version', 'nonce', 'requestDigest', 'format', 'sourceSha256', 'sourceBytes', 'limits'])
    && isRecord(value.limits) && exactKeys(value.limits, ['sourceBytes', 'resultBytes', 'expandedBytes', 'assetCount', 'assetBytes', 'diagnosticBytes', 'memoryBytes', 'cpuMilliseconds', 'wallMilliseconds', 'pids'])
    && (value as Request).version === protocolVersion
    && /^[a-f0-9]{32}$/.test((value as Request).nonce)
    && /^[a-f0-9]{64}$/.test((value as Request).requestDigest)
    && /^[a-f0-9]{64}$/.test((value as Request).sourceSha256)
    && parserFormats.has((value as Request).format)
    && Number.isSafeInteger((value as Request).sourceBytes) && (value as Request).sourceBytes >= 0
    && Number.isSafeInteger((value as Request).limits?.sourceBytes) && (value as Request).limits.sourceBytes >= (value as Request).sourceBytes && (value as Request).limits.sourceBytes <= maxSourceBytes
    && Number.isSafeInteger((value as Request).limits?.resultBytes) && (value as Request).limits.resultBytes > 0 && (value as Request).limits.resultBytes <= maxResultBytes
    && boundedPositive((value as Request).limits?.expandedBytes, maxExpandedBytes)
    && boundedPositive((value as Request).limits?.assetCount, maxAssetCount)
    && boundedPositive((value as Request).limits?.assetBytes, maxAssetBytes)
    && boundedPositive((value as Request).limits?.diagnosticBytes, maxDiagnosticBytes)
    && boundedPositive((value as Request).limits?.memoryBytes, maxMemoryBytes)
    && boundedPositive((value as Request).limits?.cpuMilliseconds, maxCpuMilliseconds)
    && boundedPositive((value as Request).limits?.wallMilliseconds, maxWallMilliseconds)
    && boundedPositive((value as Request).limits?.pids, maxPids)
    && (value as Request).requestDigest === requestDigest(value as Request)
}

async function fail(error: ParserError, request: Request): Promise<void> {
  if (request) await send({ ...request, ok: false, failureKind: 'parser', error }).catch(() => undefined)
  process.exitCode = 1
}

function abort(): void { process.exitCode = 1 }

async function send(result: Result): Promise<void> {
  const payload = encodeResult(result)
  if (payload.byteLength === 0 || payload.byteLength > maxResultBytes || payload.byteLength > result.limits.resultBytes) throw new Error('result')
  const socket = await connect(resultPath)
  try {
    await withTimeout(write(socket, Buffer.concat([u32(payload.byteLength), payload])), socket)
    const ack = await withTimeout(new BufferedReader(socket).read(4), socket)
    if (!ack.equals(Buffer.from('ACK\n'))) throw new Error('ack')
  } finally { socket.destroy() }
}

function encodeResult(result: Result): Buffer { return Buffer.from(JSON.stringify(result)) }

// SHA-256 encoding: "crux-anydoc-job-digest-v2\\0", u32be(version), then
// u32be(length)+UTF-8 bytes for nonce, format, sourceSha256, followed by
// u64be(sourceBytes), then every JobLimits field in declaration order.
function requestDigest(request: Request): string {
  const hash = createHash('sha256').update('crux-anydoc-job-digest-v2\0', 'utf8')
  hash.update(u32(request.version))
  for (const value of [request.nonce, request.format, request.sourceSha256]) {
    const bytes = Buffer.from(value, 'utf8')
    hash.update(u32(bytes.byteLength)).update(bytes)
  }
  for (const value of [request.sourceBytes, request.limits.sourceBytes, request.limits.resultBytes, request.limits.expandedBytes, request.limits.assetCount, request.limits.assetBytes, request.limits.diagnosticBytes, request.limits.memoryBytes, request.limits.cpuMilliseconds, request.limits.wallMilliseconds, request.limits.pids]) hash.update(u64(value))
  return hash.digest('hex')
}

function boundedPositive(value: unknown, ceiling: number): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= ceiling
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function parserError(error: unknown): ParserError {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
  switch (code) {
    case 'encrypted': return 'encrypted'
    case 'resourceLimit': return 'expanded-too-large'
    case 'unsupported': return 'unsupported-format'
    case 'malformed':
    case 'missingPart':
    case 'io': return 'invalid-result'
    default: return 'invalid-result'
  }
}

function nativeFormat(format: AnydocFormat): NativeFormat {
  switch (format) {
    case 'docm': return 'docx' as NativeFormat
    case 'pps':
    case 'pot': return 'ppt' as NativeFormat
    case 'pptm':
    case 'ppsx':
    case 'ppsm': return 'pptx' as NativeFormat
    case 'xls':
    case 'xlsb':
    case 'xlsm': return 'xlsx' as NativeFormat
    default: return format as NativeFormat
  }
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, timeoutMilliseconds)
    const onError = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error) }
    socket.once('error', onError)
    socket.connect(path, () => { clearTimeout(timer); socket.off('error', onError); resolve(socket) })
  })
}

function withTimeout<Value>(operation: Promise<Value>, socket: Socket): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, timeoutMilliseconds)
    operation.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

function readFrame<Value>(socket: Socket): Promise<Value> {
  const reader = new BufferedReader(socket)
  return reader.read(4).then(async (header) => {
    const length = header.readUInt32BE(0)
    if (length === 0 || length > maxResultBytes) throw new Error('frame')
    return JSON.parse((await reader.read(length)).toString('utf8')) as Value
  })
}

class BufferedReader {
  private pending = Buffer.alloc(0)
  constructor(private readonly socket: Socket) {}
  read(length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [this.pending.subarray(0, length)]
    let total = chunks[0].byteLength
    this.pending = this.pending.subarray(total)
    const done = (error?: Error): void => { this.socket.off('data', data); this.socket.off('end', end); this.socket.off('error', failRead); error ? reject(error) : resolve(Buffer.concat(chunks, total)) }
    const data = (chunk: Buffer): void => { const needed = length - total; chunks.push(chunk.subarray(0, needed)); total += Math.min(chunk.byteLength, needed); if (chunk.byteLength > needed) this.pending = Buffer.concat([this.pending, chunk.subarray(needed)]); if (total === length) done() }
    const end = (): void => done(new Error('eof'))
    const failRead = (error: Error): void => done(error)
    if (total === length) return done()
    this.socket.on('data', data); this.socket.once('end', end); this.socket.once('error', failRead)
  })
  }
}

function write(socket: Socket, value: Buffer): Promise<void> {
  return new Promise((resolve, reject) => socket.write(value, (error) => error ? reject(error) : resolve()))
}

function u32(value: number): Buffer { const buffer = Buffer.allocUnsafe(4); buffer.writeUInt32BE(value); return buffer }
function u64(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('integer')
  const buffer = Buffer.allocUnsafe(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
