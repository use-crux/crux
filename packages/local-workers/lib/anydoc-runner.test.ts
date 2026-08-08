import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = await readFile(fileURLToPath(new URL('../bin/anydoc-runner.ts', import.meta.url)), 'utf8')

describe('anydoc runner trust boundary', () => {
  it('keeps the native addon behind nonce, digest, and fixed-source validation', () => {
    const nativeImport = source.indexOf("import('@firecrawl/anydoc')")
    expect(nativeImport).toBeGreaterThan(source.indexOf('validRequest(request)'))
    expect(nativeImport).toBeGreaterThan(source.indexOf('sha256(bytes) !== request.sourceSha256'))
    expect(source).toContain("const inputPath = '/run/crux-anydoc/input/source'")
    expect(source).toContain('await file.read(')
    expect(source).not.toContain('child_process')
  })

  it('requires a bounded result frame and exact ACK before exit', () => {
    expect(source).toContain('payload.byteLength > maxResultBytes')
    expect(source).toContain("Buffer.from('ACK\\n')")
    expect(source).toContain('class BufferedReader')
    expect(source).toContain('withTimeout(readFrame<Request>(socket), socket)')
    expect(source).toContain('withTimeout(new BufferedReader(socket).read(4), socket)')
  })

  it('uses the shared canonical job digest vector and verifies it before loading Anydoc', () => {
    const request = { version: 1, nonce: 'a'.repeat(32), format: 'docx', sourceSha256: 'b'.repeat(64), sourceBytes: 3, limits: { sourceBytes: 1024, resultBytes: 2048 } }
    const digest = canonicalDigest(request)
    expect(digest).toBe('4e4347a464cdcead83d42ecbfbbe90a15bc0c95cfeb01b5b9158b2c5af2220c2')
    expect(canonicalDigest({ ...request, nonce: 'c'.repeat(32) })).not.toBe(digest)
    expect(canonicalDigest({ ...request, format: 'odt' })).not.toBe(digest)
    expect(canonicalDigest({ ...request, sourceSha256: 'c'.repeat(64) })).not.toBe(digest)
    expect(canonicalDigest({ ...request, sourceBytes: 4 })).not.toBe(digest)
    expect(canonicalDigest({ ...request, limits: { ...request.limits, resultBytes: 2049 } })).not.toBe(digest)
    expect(source).toContain('(value as Request).requestDigest === requestDigest(value as Request)')
    expect(source).toContain("'crux-anydoc-job-digest-v1\\0'")
  })

  it('ships a self-contained, integrity-described native runtime tree', async () => {
    const runtime = resolve(fileURLToPath(new URL('../dist/anydoc-runtime/', import.meta.url)))
    const manifest = JSON.parse(await readFile(resolve(runtime, 'manifest.json'), 'utf8'))
    expect(manifest.platform).toBe('linux-x64-gnu')
    expect(manifest.packages['@firecrawl/anydoc'].version).toBe('0.1.7')
    expect(manifest.packages['@firecrawl/anydoc-linux-x64-gnu'].version).toBe('0.1.7')
    expect(manifest.files.some((file: { path: string }) => file.path === 'runner.mjs')).toBe(true)
    expect(manifest.files.some((file: { path: string }) => file.path.endsWith('.node'))).toBe(true)
    for (const file of manifest.files) {
      expect(file.path.startsWith('/') || file.path.includes('..')).toBe(false)
      const info = await stat(resolve(runtime, file.path))
      expect(info.isFile()).toBe(true)
      expect(info.size).toBe(file.size)
      expect(createHash('sha256').update(await readFile(resolve(runtime, file.path))).digest('hex')).toBe(file.sha256)
    }
  })

  it('loads the staged native addon only when the packaged runtime is complete', async () => {
    const runtime = resolve(fileURLToPath(new URL('../dist/anydoc-runtime/', import.meta.url)))
    const module = await import(new URL(`file://${resolve(runtime, 'node_modules/@firecrawl/anydoc/index.js')}`).href)
    expect(typeof module.toDocument).toBe('function')
  })
})

function canonicalDigest(request: { version: number; nonce: string; format: string; sourceSha256: string; sourceBytes: number; limits: { sourceBytes: number; resultBytes: number } }): string {
  const hash = createHash('sha256').update('crux-anydoc-job-digest-v1\0')
  const u32 = (value: number): Buffer => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer }
  const u64 = (value: number): Buffer => { const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(value)); return buffer }
  hash.update(u32(request.version))
  for (const value of [request.nonce, request.format, request.sourceSha256]) {
    const bytes = Buffer.from(value)
    hash.update(u32(bytes.byteLength)).update(bytes)
  }
  for (const value of [request.sourceBytes, request.limits.sourceBytes, request.limits.resultBytes]) hash.update(u64(value))
  return hash.digest('hex')
}
