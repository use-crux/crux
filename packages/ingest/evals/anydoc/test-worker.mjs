import { createHash } from 'node:crypto'
import { Socket } from 'node:net'

const mode = process.argv[2] ?? 'success'
const ipc = new Socket({ fd: 3, readable: true, writable: true })

if (mode === 'crash') {
  process.exit(2)
}
if (mode === 'timeout') {
  setInterval(() => {}, 1_000)
} else {
  const chunks = []
  process.stdin.on('data', (chunk) => chunks.push(chunk))
  process.stdin.on('end', () => {
    if (mode === 'slow') {
      setTimeout(() => sendResult(chunks), 60)
      return
    }
    sendResult(chunks)
  })
  function sendResult(chunks) {
    if (mode === 'invalid') {
      ipc.end(Buffer.from([0, 0, 0, 1, 123]))
      return
    }
    const payload = mode === 'oversize-result'
      ? { kind: 'success', native: 'x'.repeat(256), core: {} }
      : { kind: 'success', native: { sha: createHash('sha256').update(Buffer.concat(chunks)).digest('hex') }, core: { blocks: [] }, diagnostics: [], assets: [], expandedBytes: 1 }
    const body = Buffer.from(JSON.stringify(payload))
    const header = Buffer.alloc(4)
    header.writeUInt32BE(body.length)
    ipc.end(Buffer.concat([header, body]))
  }
}
