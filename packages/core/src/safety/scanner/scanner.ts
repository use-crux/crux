/**
 * Incremental, non-repairing JSON readiness scanner.
 *
 * A single-pass code-unit state machine (never `JSON.parse` + repair, never
 * prefix re-parsing) that consumes canonical decoded text fragments, builds the
 * canonical tree, and emits a {@link ReadinessEvent} the moment each value is
 * structurally complete. It handles arbitrary chunk splits, string escapes,
 * `\u` escapes (including split surrogate halves), nested containers, and
 * multiple events per chunk. It rejects duplicate keys, invalid syntax, depth and
 * byte limits, and EOF with an incomplete root — and never adds braces, quotes,
 * commas, or otherwise guesses intent.
 *
 * Chunk boundaries never change the tree, events, errors, or decisions.
 *
 * @module
 */

import type { ReadinessEvent, ReadinessPath } from './events'
import { StructuredScanError } from './errors'
import { MAX_STRUCTURED_NESTING_DEPTH, type StructuredScanLimits } from './limits'

type Segment = string | number

interface ObjectFrame {
  readonly kind: 'object'
  readonly tree: Record<string, unknown>
  readonly keys: Set<string>
  readonly path: readonly Segment[]
  key: string | null
}

interface ArrayFrame {
  readonly kind: 'array'
  readonly tree: unknown[]
  readonly path: readonly Segment[]
}

type Frame = ObjectFrame | ArrayFrame

type Expect = 'value' | 'key' | 'colon' | 'comma-or-close' | 'done'

type Pending =
  | { kind: 'string'; value: string; escape: 'none' | 'esc' | 'u'; hex: string; isKey: boolean }
  | { kind: 'number'; raw: string }
  | { kind: 'literal'; raw: string }
  | null

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** The incremental readiness scanner surface for one structured provider value. */
export interface StructuredReadinessScanner {
  /** Consume one canonical text fragment; returns events completed within it. */
  readonly write: (fragment: string) => readonly ReadinessEvent[]
  /** Finalize at EOF: complete a trailing scalar, then require exactly one root. */
  readonly end: () => { readonly value: unknown; readonly events: readonly ReadinessEvent[] }
  /**
   * Paths of the currently-open containers (the right spine, root-first). Used by
   * the release cursor to serialize the canonical tree without prematurely closing
   * containers that are still receiving values.
   */
  readonly openContainerPaths: () => readonly (readonly Segment[])[]
  /**
   * The currently-open (non-key) string value, if any: its eventual path and the
   * safely-decoded prefix. The prefix never exposes an unfinished escape, an
   * incomplete `\u` sequence, or a lone leading surrogate — a trailing high
   * surrogate is withheld until its low surrogate arrives. Used to gate a growing
   * string (e.g. `.path().sentences()`) before its closing quote.
   */
  readonly openString: () => { readonly path: readonly Segment[]; readonly decoded: string } | undefined
}

/** Create an incremental readiness scanner for one structured provider value. */
export function createStructuredReadinessScanner(limits: StructuredScanLimits = {}): StructuredReadinessScanner {
  const maxDepth = limits.maxDepth ?? MAX_STRUCTURED_NESTING_DEPTH
  const maxBytes = limits.maxBytes
  const frames: Frame[] = []
  const events: ReadinessEvent[] = []
  let expect: Expect = 'value'
  let pending: Pending = null
  let root: unknown = undefined
  let rootDone = false
  let bytes = 0
  let seq = 0
  let failure: StructuredScanError | null = null

  const top = (): Frame | undefined => frames[frames.length - 1]

  const invalid = (detail: string): StructuredScanError =>
    new StructuredScanError('invalid-json', `Invalid structured output: ${detail}`)

  const emit = (path: ReadinessPath, value: unknown): void => {
    events.push({ seq, path: Object.freeze([...path]), value })
    seq += 1
  }

  const currentPath = (): Segment[] => {
    const frame = top()
    if (!frame) return []
    if (frame.kind === 'array') return [...frame.path, frame.tree.length]
    return [...frame.path, frame.key as string]
  }

  const completeValue = (value: unknown): void => {
    const frame = top()
    if (!frame) {
      root = value
      rootDone = true
      expect = 'done'
      emit([], value)
      return
    }
    if (frame.kind === 'array') {
      const path: Segment[] = [...frame.path, frame.tree.length]
      frame.tree.push(value)
      emit(path, value)
    } else {
      const key = frame.key
      if (key === null) throw invalid('Object value without a key.')
      frame.tree[key] = value
      emit([...frame.path, key], value)
      frame.key = null
    }
    expect = 'comma-or-close'
  }

  const openContainer = (kind: 'object' | 'array'): void => {
    if (frames.length >= maxDepth) {
      throw new StructuredScanError('depth-limit', `Structured output nested beyond depth ${maxDepth}.`)
    }
    const path = currentPath()
    if (kind === 'object') {
      frames.push({ kind: 'object', tree: {}, keys: new Set(), key: null, path })
      expect = 'key'
    } else {
      frames.push({ kind: 'array', tree: [], path })
      expect = 'value'
    }
  }

  const closeContainer = (): void => {
    const frame = frames.pop()
    if (!frame) throw invalid('Unbalanced container close.')
    completeValue(frame.tree)
  }

  const finalizeNumber = (): void => {
    const raw = (pending as { raw: string }).raw
    pending = null
    if (!NUMBER_RE.test(raw)) throw invalid(`Invalid number ${quote(raw)}.`)
    completeValue(Number(raw))
  }

  const finalizeLiteral = (): void => {
    const raw = (pending as { raw: string }).raw
    pending = null
    if (raw === 'true') return completeValue(true)
    if (raw === 'false') return completeValue(false)
    if (raw === 'null') return completeValue(null)
    throw invalid(`Invalid literal ${quote(raw)}.`)
  }

  const finishString = (current: Extract<Pending, { kind: 'string' }>): void => {
    pending = null
    if (!current.isKey) return completeValue(current.value)
    const frame = top()
    if (frame?.kind !== 'object') throw invalid('Object key outside an object.')
    if (frame.keys.has(current.value)) {
      throw new StructuredScanError('duplicate-key', `Duplicate object key ${quote(current.value)}.`)
    }
    frame.keys.add(current.value)
    frame.key = current.value
    expect = 'colon'
  }

  const consumeString = (current: Extract<Pending, { kind: 'string' }>, ch: string): void => {
    if (current.escape === 'u') {
      if (!isHex(ch)) throw invalid(`Invalid \\u escape digit ${quote(ch)}.`)
      current.hex += ch
      if (current.hex.length === 4) {
        current.value += String.fromCharCode(Number.parseInt(current.hex, 16))
        current.escape = 'none'
        current.hex = ''
      }
      return
    }
    if (current.escape === 'esc') {
      current.escape = 'none'
      const decoded = ESCAPES[ch]
      if (decoded !== undefined) {
        current.value += decoded
        return
      }
      if (ch === 'u') {
        current.escape = 'u'
        return
      }
      throw invalid(`Invalid string escape \\${ch}.`)
    }
    if (ch === '"') return finishString(current)
    if (ch === '\\') {
      current.escape = 'esc'
      return
    }
    if (ch.charCodeAt(0) < 0x20) throw invalid('Unescaped control character in a string.')
    current.value += ch
  }

  const startValue = (ch: string): void => {
    if (ch === '"') {
      pending = { kind: 'string', value: '', escape: 'none', hex: '', isKey: false }
      return
    }
    if (ch === '{') return openContainer('object')
    if (ch === '[') return openContainer('array')
    if (ch === '-' || isDigit(ch)) {
      pending = { kind: 'number', raw: ch }
      return
    }
    if (isLower(ch)) {
      pending = { kind: 'literal', raw: ch }
      return
    }
    if (ch === ']') {
      const frame = top()
      if (frame?.kind === 'array' && frame.tree.length === 0) return closeContainer()
    }
    throw invalid(`Unexpected ${quote(ch)} where a value was expected.`)
  }

  const startKey = (ch: string): void => {
    if (ch === '"') {
      pending = { kind: 'string', value: '', escape: 'none', hex: '', isKey: true }
      return
    }
    if (ch === '}') {
      const frame = top()
      if (frame?.kind === 'object' && frame.keys.size === 0) return closeContainer()
    }
    throw invalid(`Unexpected ${quote(ch)} where an object key was expected.`)
  }

  const commaOrClose = (ch: string): void => {
    const frame = top()
    if (!frame) throw invalid(`Unexpected ${quote(ch)} after the root value.`)
    if (frame.kind === 'array') {
      if (ch === ',') {
        expect = 'value'
        return
      }
      if (ch === ']') return closeContainer()
      throw invalid(`Expected ',' or ']' but found ${quote(ch)}.`)
    }
    if (ch === ',') {
      expect = 'key'
      return
    }
    if (ch === '}') return closeContainer()
    throw invalid(`Expected ',' or '}' but found ${quote(ch)}.`)
  }

  const consume = (ch: string): void => {
    if (pending) {
      if (pending.kind === 'number') {
        if (isNumberChar(ch)) {
          pending.raw += ch
          return
        }
        finalizeNumber()
        consume(ch)
        return
      }
      if (pending.kind === 'literal') {
        if (isLower(ch)) {
          pending.raw += ch
          return
        }
        finalizeLiteral()
        consume(ch)
        return
      }
      consumeString(pending, ch)
      return
    }
    if (isWhitespace(ch)) return
    switch (expect) {
      case 'value':
        return startValue(ch)
      case 'key':
        return startKey(ch)
      case 'colon':
        if (ch === ':') {
          expect = 'value'
          return
        }
        throw invalid(`Expected ':' but found ${quote(ch)}.`)
      case 'comma-or-close':
        return commaOrClose(ch)
      case 'done':
        throw new StructuredScanError('trailing-content', `Unexpected trailing content ${quote(ch)} after the root value.`)
    }
  }

  const write = (fragment: string): readonly ReadinessEvent[] => {
    if (failure) throw failure
    const start = events.length
    try {
      for (let i = 0; i < fragment.length; i += 1) {
        bytes += 1
        if (maxBytes !== undefined && bytes > maxBytes) {
          throw new StructuredScanError('byte-limit', `Structured output exceeded ${maxBytes} bytes.`)
        }
        consume(fragment[i]!)
      }
    } catch (error) {
      if (error instanceof StructuredScanError) failure = error
      throw error
    }
    return events.slice(start)
  }

  const end = (): { value: unknown; events: readonly ReadinessEvent[] } => {
    if (failure) throw failure
    const start = events.length
    try {
      if (pending) {
        if (pending.kind === 'number') finalizeNumber()
        else if (pending.kind === 'literal') finalizeLiteral()
        else throw new StructuredScanError('incomplete', 'Structured output ended inside a string.')
      }
      if (frames.length > 0) {
        throw new StructuredScanError('incomplete', 'Structured output ended with an unclosed container.')
      }
      if (!rootDone) {
        throw new StructuredScanError('incomplete', 'Structured output ended before a complete root value.')
      }
    } catch (error) {
      if (error instanceof StructuredScanError) failure = error
      throw error
    }
    return { value: root, events: events.slice(start) }
  }

  const openContainerPaths = (): readonly (readonly Segment[])[] => frames.map((frame) => frame.path)

  const openString = (): { path: readonly Segment[]; decoded: string } | undefined => {
    if (!pending || pending.kind !== 'string' || pending.isKey) return undefined
    return { path: currentPath(), decoded: safeDecoded(pending.value) }
  }

  return { write, end, openContainerPaths, openString }
}

/**
 * The decoded prefix safe to expose: withhold a trailing lone high surrogate so an
 * incomplete surrogate pair is never surfaced. In-progress escape bytes are not yet
 * in `value`, so no other truncation is needed.
 */
function safeDecoded(value: string): string {
  if (value.length === 0) return value
  const last = value.charCodeAt(value.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isNumberChar(ch: string): boolean {
  return isDigit(ch) || ch === '-' || ch === '+' || ch === '.' || ch === 'e' || ch === 'E'
}

function isLower(ch: string): boolean {
  return ch >= 'a' && ch <= 'z'
}

function isHex(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}

function quote(value: string): string {
  return JSON.stringify(value)
}
