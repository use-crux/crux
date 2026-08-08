import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
  })
})
