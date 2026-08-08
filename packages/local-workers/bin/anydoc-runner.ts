import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { Socket } from 'node:net'

const protocolVersion = 1
const maxSourceBytes = 64 << 20
const maxResultBytes = 8 << 20

type Request = { version: number; nonce: string; digest: string }
type Result = { version: number; ok: boolean; error?: string; payload?: string }

const [capabilityPath, resultPath, inputPath, format] = process.argv.slice(2)

void main()

async function main(): Promise<void> {
  if (!capabilityPath || !resultPath || !inputPath || !format) return fail('invalid-request')
  const request = await receiveRequest(capabilityPath).catch(() => undefined)
  if (!validRequest(request)) return fail('replay')

  const bytes = await readSource(inputPath).catch(() => undefined)
  if (!bytes) return fail('invalid-request')
  if (sha256(bytes) !== request.digest) return fail('replay')

  let payload: unknown
  if (format === '__crux_anydoc_test__') {
    payload = { schemaVersion: 1, format, sourceBytes: bytes.byteLength }
  } else {
    try {
      // This literal is intentionally post-capability: the bundled runner's
      // top level has only Node builtins, so untrusted launches cannot load the
      // native addon before proving possession of this run's nonce and digest.
      const anydoc = await import('@firecrawl/anydoc')
      payload = await anydoc.toDocument(bytes, format as never)
    } catch {
      return fail('invalid-result')
    }
  }
  await send({ version: protocolVersion, ok: true, payload: Buffer.from(JSON.stringify(payload)).toString('base64') })
}

async function receiveRequest(path: string): Promise<Request> {
  const socket = await connect(path)
  try { return await readFrame<Request>(socket) } finally { socket.destroy() }
}

async function readSource(path: string): Promise<Buffer> {
  const stat = await fs.stat(path)
  if (!stat.isFile() || stat.size < 0 || stat.size > maxSourceBytes) throw new Error('source')
  return fs.readFile(path)
}

function validRequest(value: unknown): value is Request {
  return !!value && typeof value === 'object'
    && (value as Request).version === protocolVersion
    && /^[a-f0-9]{32}$/.test((value as Request).nonce)
    && /^[a-f0-9]{64}$/.test((value as Request).digest)
}

async function fail(error: string): Promise<void> {
  await send({ version: protocolVersion, ok: false, error }).catch(() => undefined)
  process.exitCode = 1
}

async function send(result: Result): Promise<void> {
  const payload = Buffer.from(JSON.stringify(result))
  if (payload.byteLength === 0 || payload.byteLength > maxResultBytes) throw new Error('result')
  const socket = await connect(resultPath)
  try {
    await write(socket, Buffer.concat([u32(payload.byteLength), payload]))
    const ack = await readExact(socket, 4)
    if (!ack.equals(Buffer.from('ACK\n'))) throw new Error('ack')
  } finally { socket.destroy() }
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    socket.once('error', reject)
    socket.connect(path, () => { socket.off('error', reject); resolve(socket) })
  })
}

function readFrame<Value>(socket: Socket): Promise<Value> {
  return readExact(socket, 4).then(async (header) => {
    const length = header.readUInt32BE(0)
    if (length === 0 || length > maxResultBytes) throw new Error('frame')
    return JSON.parse((await readExact(socket, length)).toString('utf8')) as Value
  })
}

function readExact(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const done = (error?: Error): void => { socket.off('data', data); socket.off('end', end); socket.off('error', failRead); error ? reject(error) : resolve(Buffer.concat(chunks, total)) }
    const data = (chunk: Buffer): void => { const needed = length - total; chunks.push(chunk.subarray(0, needed)); total += Math.min(chunk.byteLength, needed); if (total === length) done() }
    const end = (): void => done(new Error('eof'))
    const failRead = (error: Error): void => done(error)
    socket.on('data', data); socket.once('end', end); socket.once('error', failRead)
  })
}

function write(socket: Socket, value: Buffer): Promise<void> {
  return new Promise((resolve, reject) => socket.write(value, (error) => error ? reject(error) : resolve()))
}

function u32(value: number): Buffer { const buffer = Buffer.allocUnsafe(4); buffer.writeUInt32BE(value); return buffer }
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
