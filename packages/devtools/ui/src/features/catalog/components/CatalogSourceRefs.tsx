/**
 * Source-view rendering for `definition.sourceRefs`.
 *
 * Renders the primary authored snippet and any supporting refs as a
 * flat vertical stack of collapsible cards. Each card uses the same
 * `L_Code` block component, so the primary call site and supporting
 * sources share one visual vocabulary.
 *
 * Tokenizer is a ~30-line regex pass — no Shiki / Prism. Matches the
 * design token palette (fgFaint / ok / iris / warn / crux / fg /
 * fgMuted) so themes stay consistent.
 */

import { useMemo, useState } from 'react'
import { Icon } from '@/qw/shell/Icon'
import { stripRoot } from '@/features/catalog/components/CatalogTree'
import type { ProjectSourceRef, ProjectSourceRefRole, SourceSnippet } from '@/types'

// ─── Tokenizer ───────────────────────────────────────────────────────

type TokenClass = 'c' | 's' | 'k' | 'n' | 'f' | 'i' | 'p' | 't'

interface Token {
  cls: TokenClass
  text: string
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this',
  'super', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'import', 'export', 'from', 'as', 'async', 'await', 'yield', 'try',
  'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
  'true', 'false', 'null', 'undefined', 'void', 'never', 'any', 'unknown',
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'public',
  'private', 'protected', 'readonly', 'static', 'abstract', 'declare',
  'namespace', 'module', 'satisfies', 'keyof', 'infer', 'is',
])

const TOKEN_COLOR: Record<TokenClass, string> = {
  c: 'var(--qw-fg-faint)',
  s: 'var(--qw-ok)',
  k: 'var(--qw-iris)',
  n: 'var(--qw-warn)',
  f: 'var(--qw-crux)',
  i: 'var(--qw-fg)',
  p: 'var(--qw-fg-muted)',
  t: 'var(--qw-fg)',
}

/** Lightweight TS/JS tokenizer — regex alternation, single pass. Doesn't
 *  understand JSX, but handles comments, template literals (incl.
 *  multi-line), strings, regex-ish (skipped), numbers, identifiers (with
 *  function-call lookahead) and punctuation. Anything that doesn't match
 *  becomes whitespace/text. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  // Combined alternation. Order matters — longer/specific patterns first.
  const pattern =
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|\$\{[\s\S]*?\}|[^`\\])*`)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_.]*(?:[eE][+-]?\d+)?n?\b)|(\b[A-Za-z_$][\w$]*\b)|([{}()[\];,.:?<>=+\-*/!&|^~%@#]+)|(\s+)|([\s\S])/g

  let m: RegExpExecArray | null
  while ((m = pattern.exec(source)) !== null) {
    if (m[1]) tokens.push({ cls: 'c', text: m[1] })
    else if (m[2]) tokens.push({ cls: 'c', text: m[2] })
    else if (m[3]) tokens.push({ cls: 's', text: m[3] })
    else if (m[4]) tokens.push({ cls: 's', text: m[4] })
    else if (m[5]) tokens.push({ cls: 'n', text: m[5] })
    else if (m[6]) {
      if (KEYWORDS.has(m[6])) {
        tokens.push({ cls: 'k', text: m[6] })
      } else {
        // Function-call lookahead: identifier followed by `(`
        const next = source[pattern.lastIndex]
        tokens.push({ cls: next === '(' ? 'f' : 'i', text: m[6] })
      }
    }
    else if (m[7]) tokens.push({ cls: 'p', text: m[7] })
    else if (m[8]) tokens.push({ cls: 't', text: m[8] })
    else if (m[9]) tokens.push({ cls: 't', text: m[9] })
  }
  return tokens
}

interface LineToken {
  cls: TokenClass | null
  text: string
}

/** Split tokenized output into lines so a 2-column grid (gutter + body)
 *  can render each line independently. A multi-line token (template
 *  literal, block comment) gets split across lines, preserving its
 *  token class. */
function tokensToLines(tokens: Token[]): LineToken[][] {
  const lines: LineToken[][] = [[]]
  for (const tok of tokens) {
    const parts = tok.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        lines[lines.length - 1].push({ cls: tok.cls, text: parts[i] })
      }
      if (i < parts.length - 1) lines.push([])
    }
  }
  // Drop a trailing empty line introduced by sources that end in `\n`.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
}

// ─── L_Code ──────────────────────────────────────────────────────────

interface LCodeProps {
  code: string
  /** Line number the first row should display. Defaults to 1. */
  startLine?: number
  /** Optional cap with internal vertical scroll. */
  maxHeight?: number
  /** Optional list of (1-based, absolute) line numbers to tint. */
  highlightLines?: readonly number[]
}

export function L_Code({ code, startLine = 1, maxHeight, highlightLines }: LCodeProps) {
  const lines = useMemo(() => tokensToLines(tokenize(code)), [code])
  const highlightSet = useMemo(
    () => (highlightLines && highlightLines.length > 0 ? new Set(highlightLines) : null),
    [highlightLines],
  )
  // Off by default. When on, long lines break inside their cell instead
  // of forcing the outer container to scroll horizontally.
  const [wrap, setWrap] = useState(false)

  // Reserve gutter width based on the largest line number — keeps the
  // body column aligned regardless of how deep the snippet runs.
  const lastLineNo = startLine + lines.length - 1
  const gutterWidth = Math.max(36, 16 + String(lastLineNo).length * 8)

  return (
    <div className="relative" style={{ background: 'var(--qw-bg)' }}>
      {/* Wrap toggle — small floating chip in the top-right corner. The
          button sits outside the scroll container so it stays put when
          the user scrolls a long line horizontally. */}
      <button
        type="button"
        onClick={() => setWrap((v) => !v)}
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-[5px] px-1.5 py-[2px] font-mono text-[10px] transition-colors hover:opacity-90"
        style={{
          background: wrap ? 'var(--qw-crux-soft)' : 'var(--qw-bg-elev)',
          color: wrap ? 'var(--qw-crux)' : 'var(--qw-fg-muted)',
          border: '1px solid var(--qw-border)',
        }}
        title={wrap ? 'Disable line wrap' : 'Enable line wrap'}
        aria-pressed={wrap}
      >
        {wrap ? 'wrap · on' : 'wrap'}
      </button>
      {/* One scroll container for the whole block. The inner grid sizes
          to `max-content` when wrap is off so a long line pushes the
          whole grid wider and the outer container scrolls horizontally
          as a unit — gutter + body move together. When wrap is on the
          grid fills the parent and lines break inside the body cell. */}
      <div
        style={{
          overflowX: wrap ? 'hidden' : 'auto',
          overflowY: maxHeight ? 'auto' : undefined,
          maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        }}
      >
        <div
          className="grid font-mono text-[12px] leading-[1.55]"
          style={{
            gridTemplateColumns: `${gutterWidth}px ${wrap ? '1fr' : 'max-content'}`,
            width: wrap ? '100%' : 'max-content',
            minWidth: '100%',
          }}
        >
          {lines.map((line, i) => {
            const lineNo = startLine + i
            const isHi = highlightSet?.has(lineNo) ?? false
            return (
              <div key={i} className="contents">
                <div
                  className="select-none px-2 py-[1px] text-right"
                  style={{
                    color: isHi ? 'var(--qw-warn)' : 'var(--qw-fg-faint)',
                    background: isHi ? 'var(--qw-warn-soft)' : 'var(--qw-bg-elev)',
                    borderRight: '1px solid var(--qw-border)',
                    fontVariantNumeric: 'tabular-nums',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                  }}
                >
                  {lineNo}
                </div>
                <pre
                  className="m-0 px-4 py-[1px]"
                  style={{
                    background: isHi ? 'var(--qw-warn-soft)' : 'transparent',
                    whiteSpace: wrap ? 'pre-wrap' : 'pre',
                    wordBreak: wrap ? 'break-word' : 'normal',
                  }}
                >
                  {line.length === 0 ? (
                    // Empty line — render a space so row height matches non-empty rows.
                    <span> </span>
                  ) : (
                    line.map((tok, j) => (
                      <span key={j} style={tok.cls ? { color: TOKEN_COLOR[tok.cls] } : undefined}>
                        {tok.text}
                      </span>
                    ))
                  )}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── SourceRefCard ───────────────────────────────────────────────────

const ROLE_TONE: Record<ProjectSourceRefRole, string> = {
  schema: 'var(--qw-iris)',
  prompt: 'var(--qw-crux)',
  system: 'var(--qw-crux)',
  config: 'var(--qw-iris)',
  callback: 'var(--qw-ok)',
  execute: 'var(--qw-ok)',
  handler: 'var(--qw-ok)',
  validator: 'var(--qw-warn)',
  policy: 'var(--qw-warn)',
  resolver: 'var(--qw-warn)',
  helper: 'var(--qw-fg-muted)',
}

function roleColor(role: string): string {
  return (ROLE_TONE as Record<string, string | undefined>)[role] ?? 'var(--qw-fg-muted)'
}

interface SourceRefCardProps {
  refItem: ProjectSourceRef
  projectRoot: string | undefined
  defaultOpen?: boolean
}

function SourceRefCard({ refItem, projectRoot, defaultOpen = true }: SourceRefCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const tone = roleColor(refItem.role)
  const snippet = refItem.snippet
  const ident = refItem.symbol ?? '(anonymous)'
  const startLine = snippet?.range.startLine ?? refItem.source.line ?? 1
  const file = stripRoot(refItem.source.file, projectRoot)
  const line = refItem.source.line
  const fidelityTone = refItem.fidelity === 'resolved' ? 'var(--qw-ok)' : 'var(--qw-warn)'
  const fidelityBg = refItem.fidelity === 'resolved' ? 'var(--qw-ok-soft)' : 'var(--qw-warn-soft)'

  return (
    <div
      className="mb-3 overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left font-mono text-[11px] transition-colors hover:opacity-90"
        style={{
          borderBottom: open ? '1px solid var(--qw-border)' : 'none',
          background: 'var(--qw-bg-muted)',
          color: 'var(--qw-fg-muted)',
        }}
        aria-expanded={open}
      >
        <svg
          width={10}
          height={10}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span
          className="inline-flex items-center rounded-[4px] px-1.5 py-[1px] text-[10px] lowercase"
          style={{
            background: 'var(--qw-bg)',
            color: tone,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 28%, transparent)`,
          }}
        >
          {refItem.role}
        </span>
        <span className="font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {ident}
        </span>
        {refItem.property && (
          <span style={{ color: 'var(--qw-fg-faint)' }}>· {refItem.property}</span>
        )}
        <span style={{ color: 'var(--qw-fg-faint)' }}>
          {file}
          <span style={{ color: 'var(--qw-crux)' }}>:{line}</span>
        </span>
        <span
          className="ml-auto inline-flex items-center rounded-[4px] px-1.5 py-[1px] text-[10px] lowercase"
          style={{
            background: fidelityBg,
            color: fidelityTone,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${fidelityTone} 28%, transparent)`,
          }}
        >
          {refItem.fidelity}
        </span>
      </button>
      {open && snippet && (
        <>
          {snippet.truncated && (
            <div
              className="px-3.5 py-1.5 font-mono text-[10.5px]"
              style={{
                background: 'var(--qw-warn-soft)',
                color: 'var(--qw-warn)',
                borderBottom: '1px solid var(--qw-border)',
              }}
            >
              truncated · only the head of the function body was statically resolvable
            </div>
          )}
          <L_Code code={snippet.source} startLine={startLine} />
        </>
      )}
    </div>
  )
}

// ─── Primary source card (uses L_Code, same vocabulary) ──────────────

interface PrimarySourceCardProps {
  file: string | undefined
  snippet: SourceSnippet
  language?: string
  projectRoot: string | undefined
}

export function PrimarySourceCard({ file, snippet, language, projectRoot }: PrimarySourceCardProps) {
  const startLine = snippet.range.startLine
  const endLine = snippet.range.endLine ?? snippet.range.startLine
  const filePath = file ? stripRoot(file, projectRoot) : null

  return (
    <div
      className="mb-3 overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
          color: 'var(--qw-fg-muted)',
        }}
      >
        <Icon name="doc" size={11} />
        {filePath && <span>{filePath}</span>}
        <span style={{ color: 'var(--qw-fg-faint)' }}>
          · lines {startLine}–{endLine}
        </span>
        <span className="ml-auto" style={{ color: 'var(--qw-fg-faint)' }}>
          {language ?? snippet.language ?? 'source'}
        </span>
      </div>
      {snippet.truncated && (
        <div
          className="px-3.5 py-1.5 font-mono text-[10.5px]"
          style={{
            background: 'var(--qw-warn-soft)',
            color: 'var(--qw-warn)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          truncated · only the head of the function body was statically resolvable
        </div>
      )}
      <L_Code code={snippet.source} startLine={startLine} />
    </div>
  )
}

// ─── SourceRefs list ─────────────────────────────────────────────────

interface SourceRefsProps {
  refs: readonly ProjectSourceRef[] | undefined
  projectRoot: string | undefined
}

export function SourceRefsList({ refs, projectRoot }: SourceRefsProps) {
  if (!refs || refs.length === 0) return null
  return (
    <div className="mb-5">
      {refs.map((r) => (
        <SourceRefCard key={r.id} refItem={r} projectRoot={projectRoot} />
      ))}
    </div>
  )
}
