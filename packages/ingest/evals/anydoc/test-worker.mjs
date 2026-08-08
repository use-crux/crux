import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'

const mode = process.argv[2] ?? 'success'
const ipc = new Socket({ fd: 3, readable: true, writable: true })

if (mode === 'crash') {
  process.exit(2)
}
if (mode === 'timeout') {
  setInterval(() => {}, 1_000)
} else if (mode === 'descendant') {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  void writeFile(process.argv[3], String(descendant.pid))
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
    const sha = createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
    if (mode === 'stdout') {
      process.stdout.write('x'.repeat(256))
    }
    if (mode === 'stderr') {
      process.stderr.write('x'.repeat(256))
    }
    if (mode === 'cpu') {
      const until = Date.now() + 100
      while (Date.now() < until) {}
    }
    const payload = mode === 'oversize-result'
      ? { kind: 'success', native: 'x'.repeat(256), core: {} }
      : mode === 'missing-counts'
        ? { kind: 'success', native: { value: {}, diagnostics: [], assets: [] }, core: { value: {}, diagnostics: [], assets: [] }, expandedBytes: 1 }
        : mode === 'asset-mismatch'
          ? { ...successPayload(sha), assets: { count: 1, byteLength: 1 } }
          : mode === 'expansion'
            ? { ...successPayload(sha), expandedBytes: 256 }
        : successPayload(sha)
    const body = Buffer.from(JSON.stringify(payload))
    const header = Buffer.alloc(4)
    header.writeUInt32BE(body.length)
    ipc.end(Buffer.concat([header, body]))
  }
}

function successPayload(sha) {
  const diagnostics = []
  const assets = []
  const native = { value: { sha }, diagnostics, assets }
  const core = { value: { blocks: [] }, diagnostics, assets }
  return { kind: 'success', native, core, diagnostics: { count: 0, byteLength: 0 }, assets: { count: 0, byteLength: 0 }, expandedBytes: 1 }
}
