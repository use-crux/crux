import { Buffer } from 'node:buffer'

export type RawResultLimits = { expandedBytes: number; resultBytes: number; assetCount: number; assetBytes: number }
export type RawAsset = { id: number; mediaType: string; originPart: string; data: Buffer }
export type RawDocument = Record<string, unknown> & { blocks: unknown[]; notes: unknown[]; assets: RawAsset[] }
type Admission = { native: unknown; core: unknown }

type Preflight = { document: RawDocument; assets: RawAsset[]; assetBytes: number; maxTraversalFrames: number }
type Failure = { error: 'invalid-result' | 'expanded-too-large' }

export function preflightRawDocument(payload: unknown, limits: RawResultLimits): Preflight | Failure {
  if (!isRecord(payload) || !exactKeys(payload, ['blocks', 'notes', 'assets']) || !Array.isArray(payload.blocks) || !Array.isArray(payload.notes) || !Array.isArray(payload.assets)) return { error: 'invalid-result' }
  if (payload.assets.length > limits.assetCount) return { error: 'invalid-result' }

  const assets: RawAsset[] = []
  const allowedBinary = new Set<Uint8Array>()
  let assetBytes = 0
  for (const value of payload.assets) {
    if (!isRecord(value) || !exactKeys(value, ['id', 'mediaType', 'originPart', 'data']) || !Number.isSafeInteger(value.id) || typeof value.mediaType !== 'string' || typeof value.originPart !== 'string' || !Buffer.isBuffer(value.data)) return { error: 'invalid-result' }
    const asset = value as RawAsset
    assetBytes = saturatedAdd(assetBytes, asset.data.byteLength)
    if (assetBytes > limits.assetBytes) return { error: 'invalid-result' }
    assets.push(asset)
    allowedBinary.add(asset.data)
  }

  const structuralBudget = Math.min(limits.expandedBytes, limits.resultBytes)
  const nodeCeiling = Math.max(1, Math.floor(structuralBudget / 2))
  const keyCeiling = Math.max(1, Math.floor(structuralBudget / 4))
  let nodes = 0
  let keys = 0
  let jsonUpperBound = 0
  let maxTraversalFrames = 0
  const frames: Iterator<unknown>[] = []
  let current: unknown = payload

  for (;;) {
    nodes++
    if (nodes > nodeCeiling || frames.length + 1 > 128) return { error: 'expanded-too-large' }
    jsonUpperBound = saturatedAdd(jsonUpperBound, scalarUpperBound(current))
    if (current instanceof Uint8Array) {
      if (!allowedBinary.has(current)) return { error: 'invalid-result' }
    } else {
      const children = childIterator(current, (key) => {
        keys++
        jsonUpperBound = saturatedAdd(jsonUpperBound, 3 + 6 * key.length)
      })
      if (children) {
        frames.push(children)
        maxTraversalFrames = Math.max(maxTraversalFrames, frames.length)
      }
    }
    if (keys > keyCeiling || saturatedAdd(jsonUpperBound, assetBytes) > limits.expandedBytes) return { error: 'expanded-too-large' }

    let next: IteratorResult<unknown> | undefined
    while (frames.length > 0) {
      next = frames[frames.length - 1]!.next()
      if (!next.done) break
      frames.pop()
      next = undefined
    }
    if (!next) break
    current = next.value
  }

  return { document: payload as RawDocument, assets, assetBytes, maxTraversalFrames }
}

export function encodeAdmissionResult(
  request: { resultBytes: number; sourceBytes: number },
  admission: Admission,
  rawBytes: number,
  assets: readonly RawAsset[],
  accounting: Readonly<Record<string, number>>,
  codecs: { base64: (data: Buffer) => string; stringify: (value: unknown) => string } = {
    base64: (data) => data.toString('base64'),
    stringify: JSON.stringify,
  },
): { bytes: Buffer } | Failure {
  const innerBytes = admissionResultInnerBytes(rawBytes, assets)
  const outerBytes = saturatedAdd(base64Bytes(innerBytes), resultEnvelopeBytes(request, accounting))
  if (outerBytes > request.resultBytes) return { error: 'invalid-result' }

  const payload = {
    kind: 'anydoc-admission-v2',
    native: admission.native,
    core: admission.core,
    assets: assets.map(({ id, mediaType, originPart, data }) => ({ id, mediaType, originPart, data: codecs.base64(data) })),
    diagnostics: [],
  }
  return { bytes: Buffer.from(codecs.stringify(payload)) }
}

function admissionResultInnerBytes(rawBytes: number, assets: readonly RawAsset[]): number {
  let bytes = saturatedAdd(Buffer.byteLength('{"kind":"anydoc-admission-v2","native":,"core":'), rawBytes)
  bytes = saturatedAdd(bytes, Buffer.byteLength(',"assets":['))
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index]!
    if (index > 0) bytes = saturatedAdd(bytes, 1)
    bytes = saturatedAdd(bytes, Buffer.byteLength('{"id":'))
    bytes = saturatedAdd(bytes, decimalBytes(asset.id))
    bytes = saturatedAdd(bytes, Buffer.byteLength(',"mediaType":'))
    bytes = saturatedAdd(bytes, jsonStringBytes(asset.mediaType))
    bytes = saturatedAdd(bytes, Buffer.byteLength(',"originPart":'))
    bytes = saturatedAdd(bytes, jsonStringBytes(asset.originPart))
    bytes = saturatedAdd(bytes, Buffer.byteLength(',"data":""}'))
    bytes = saturatedAdd(bytes, base64Bytes(asset.data.byteLength))
  }
  return saturatedAdd(bytes, Buffer.byteLength('],"diagnostics":[]}'))
}

function resultEnvelopeBytes(request: { sourceBytes: number }, accounting: Readonly<Record<string, number>>): number {
  let bytes = 4096
  bytes = saturatedAdd(bytes, decimalBytes(request.sourceBytes))
  for (const value of Object.values(accounting)) bytes = saturatedAdd(bytes, decimalBytes(value))
  return bytes
}

function childIterator(value: unknown, onKey: (key: string) => void): Iterator<unknown> | undefined {
  if (Array.isArray(value)) return value.values()
  if (!isRecord(value)) return undefined
  return (function* (): Generator<unknown> {
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        onKey(key)
        yield value[key]
      }
    }
  })()
}

function scalarUpperBound(value: unknown): number {
  if (typeof value === 'string') return saturatedAdd(2, 6 * value.length)
  if (typeof value === 'number') return 32
  if (typeof value === 'boolean') return 5
  if (value === null) return 4
  if (Array.isArray(value)) return saturatedAdd(2, value.length)
  if (isRecord(value)) return 2
  if (value instanceof Uint8Array) return 0
  return Number.MAX_SAFE_INTEGER
}

function jsonStringBytes(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2
    else if (code < 0x20 || code >= 0xd800 && code <= 0xdfff) bytes += 6
    else if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else bytes += 3
  }
  return bytes
}

function decimalBytes(value: number): number { return String(value).length }
function base64Bytes(value: number): number { return saturatedMultiply(Math.ceil(value / 3), 4) }
function saturatedAdd(left: number, right: number): number { return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right }
function saturatedMultiply(left: number, right: number): number { return left > Number.MAX_SAFE_INTEGER / right ? Number.MAX_SAFE_INTEGER : left * right }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key)) }
