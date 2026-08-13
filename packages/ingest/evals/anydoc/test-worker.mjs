import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'

const mode = process.argv[2] ?? 'success'
const ipc = new Socket({ fd: 3, readable: true, writable: true })
const control = new Socket({ fd: 4, readable: true, writable: true })

if (mode === 'crash') {
  process.exit(2)
}
if (mode === 'timeout') {
  setInterval(() => {}, 1_000)
} else if (mode === 'descendant' || mode === 'descendant-ignore' || mode === 'descendant-crash') {
  const code = mode === 'descendant-ignore' || mode === 'descendant-crash'
    ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    : 'setInterval(() => {}, 1000)'
  const descendant = spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
  void writeFile(process.argv[3], String(descendant.pid))
  if (mode === 'descendant-crash') {
    setTimeout(() => process.exit(2), 20)
  } else {
    setInterval(() => {}, 1_000)
  }
} else {
  const chunks = []
  process.stdin.on('data', (chunk) => chunks.push(chunk))
  process.stdin.on('end', () => {
    if (mode === 'runaway') {
      setInterval(() => {
        const until = Date.now() + 25
        while (Date.now() < until) {}
      }, 0)
      return
    }
    if (mode === 'slow') {
      setTimeout(() => sendResult(chunks), 60)
      return
    }
    sendResult(chunks)
  })
  function sendResult(chunks) {
    if (mode.startsWith('adapter-failure:')) {
      const error = mode.slice('adapter-failure:'.length)
      const payload = failurePayload(error)
      const body = Buffer.from(JSON.stringify(payload))
      const header = Buffer.alloc(4)
      header.writeUInt32BE(body.length)
      ipc.end(Buffer.concat([header, body]))
      control.once('data', (ack) => {
        if (ack.toString() === 'ACK\n') control.end('ACKED\n', () => process.exit(0))
      })
      return
    }
    if (mode === 'invalid') {
      ipc.end(Buffer.from([0, 0, 0, 1, 123]))
      control.destroy()
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
    if (mode === 'cpu-after-result') {
      const until = Date.now() + 100
      while (Date.now() < until) {}
    }
    control.once('data', (ack) => {
      if (ack.toString() === 'ACK\n') {
        control.end('ACKED\n', () => process.exit(0))
      }
    })
  }
}

function successPayload(sha) {
  const diagnostics = []
  const assets = []
  const native = { value: { sha }, diagnostics, assets }
  const core = { value: { blocks: [] }, diagnostics, assets }
  return { kind: 'success', native, core, diagnostics: { count: 0, byteLength: 0 }, assets: { count: 0, byteLength: 0 }, expandedBytes: 1 }
}

function failurePayload(error) {
  const diagnostics = [`adapter: ${error}`]
  const assets = []
  const native = { value: { outcome: { kind: 'failure', error } }, diagnostics, assets }
  const core = { value: { outcome: { kind: 'failure', error } }, diagnostics, assets }
  return { kind: 'success', native, core, diagnostics: { count: diagnostics.length, byteLength: Buffer.byteLength(diagnostics.join('')) }, assets: { count: 0, byteLength: 0 }, expandedBytes: 1 }
}
