import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { Socket } from 'node:net'

const protocolVersion = 1
const maxSourceBytes = 64 << 20
const maxResultBytes = 8 << 20
const inputPath = '/run/crux-anydoc/input/source'
const timeoutMilliseconds = 25_000
const candidateFormats = new Set(['doc', 'docm', 'rtf', 'odt', 'epub', 'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm', 'odp', 'docx', 'xls', 'xlsb', 'ods'])

type Request = { version: number; nonce: string; requestDigest: string; format: string; sourceSha256: string; sourceBytes: number; limits: { sourceBytes: number; resultBytes: number } }
type Result = Request & { ok: boolean; error?: string; payload?: string; accounting?: { sourceBytes: number } }

const [capabilityPath, resultPath] = process.argv.slice(2)

void main()

async function main(): Promise<void> {
  if (!capabilityPath || !resultPath) return fail('invalid-request')
  const request = await receiveRequest(capabilityPath).catch(() => undefined)
  if (!validRequest(request)) return fail('replay')

  const bytes = await readSource(inputPath, request.limits.sourceBytes).catch(() => undefined)
  if (!bytes) return fail('invalid-request')
  if (bytes.byteLength !== request.sourceBytes || sha256(bytes) !== request.sourceSha256) return fail('replay')

  let payload: unknown
  try {
    // This literal is intentionally post-capability: the bundled runner's
    // top level has only Node builtins, so untrusted launches cannot load the
    // native addon before proving possession of this run's nonce and digest.
    const anydoc = await import('@firecrawl/anydoc')
    payload = await anydoc.toDocument(bytes, request.format as never)
  } catch {
    return fail('invalid-result', request)
  }
  await send({ ...request, ok: true, payload: Buffer.from(JSON.stringify(payload)).toString('base64'), accounting: { sourceBytes: bytes.byteLength } })
}

async function receiveRequest(path: string): Promise<Request> {
  const socket = await connect(path)
  try { return await withTimeout(readFrame<Request>(socket), socket) } finally { socket.destroy() }
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
  return !!value && typeof value === 'object'
    && (value as Request).version === protocolVersion
    && /^[a-f0-9]{32}$/.test((value as Request).nonce)
    && /^[a-f0-9]{64}$/.test((value as Request).requestDigest)
    && /^[a-f0-9]{64}$/.test((value as Request).sourceSha256)
    && candidateFormats.has((value as Request).format)
    && Number.isSafeInteger((value as Request).sourceBytes) && (value as Request).sourceBytes >= 0
    && Number.isSafeInteger((value as Request).limits?.sourceBytes) && (value as Request).limits.sourceBytes >= (value as Request).sourceBytes && (value as Request).limits.sourceBytes <= maxSourceBytes
    && Number.isSafeInteger((value as Request).limits?.resultBytes) && (value as Request).limits.resultBytes > 0 && (value as Request).limits.resultBytes <= maxResultBytes
    && (value as Request).requestDigest === requestDigest(value as Request)
}

async function fail(error: string, request?: Request): Promise<void> {
  if (request) await send({ ...request, ok: false, error }).catch(() => undefined)
  process.exitCode = 1
}

async function send(result: Result): Promise<void> {
  const payload = Buffer.from(JSON.stringify(result))
  if (payload.byteLength === 0 || payload.byteLength > maxResultBytes || payload.byteLength > result.limits.resultBytes) throw new Error('result')
  const socket = await connect(resultPath)
  try {
    await withTimeout(write(socket, Buffer.concat([u32(payload.byteLength), payload])), socket)
    const ack = await withTimeout(new BufferedReader(socket).read(4), socket)
    if (!ack.equals(Buffer.from('ACK\n'))) throw new Error('ack')
  } finally { socket.destroy() }
}

// SHA-256 encoding: "crux-anydoc-job-digest-v1\\0", u32be(version), then
// u32be(length)+UTF-8 bytes for nonce, format, sourceSha256, followed by
// u64be(sourceBytes), u64be(limits.sourceBytes), u64be(limits.resultBytes).
function requestDigest(request: Request): string {
  const hash = createHash('sha256').update('crux-anydoc-job-digest-v1\0', 'utf8')
  hash.update(u32(request.version))
  for (const value of [request.nonce, request.format, request.sourceSha256]) {
    const bytes = Buffer.from(value, 'utf8')
    hash.update(u32(bytes.byteLength)).update(bytes)
  }
  for (const value of [request.sourceBytes, request.limits.sourceBytes, request.limits.resultBytes]) hash.update(u64(value))
  return hash.digest('hex')
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, timeoutMilliseconds)
    socket.once('error', reject)
    socket.connect(path, () => { clearTimeout(timer); socket.off('error', reject); resolve(socket) })
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
