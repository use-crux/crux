import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { BundledLanguage, ThemedToken } from 'shiki'
import { Icon } from '@/qw/shell/Icon'
import { highlightCode } from '@/shared/components/ai-elements/code-block'
import type { QualitySourceFrame, QualitySourceFrameLine } from '@/types'

const FRAME_UNAVAILABLE: Record<string, string> = {
  'no-source-ref': 'No source location was captured for this check.',
  'source-map-missing': 'The source map needed to resolve this location is missing.',
  'source-file-missing': 'The authored source file could not be found on disk.',
  'source-line-missing': 'The authored source line is no longer present in the file.',
  'source-root-missing': 'The source root for this historical record is unavailable.',
  'invalid-source-ref': 'The captured source location is not in a readable file:line format.',
  'source-outside-project': 'The location resolves outside the project root.',
  'unsupported-language': 'Source snapshots are not supported for this language yet.',
  'unsupported-source-file': 'Source snapshots are not supported for this file type yet.',
}

interface LineRoleStyle {
  background: string
  accent: string
  label: string | null
  text: string
  weight: number
}

type HighlightedCode = NonNullable<ReturnType<typeof highlightCode>>

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline.
// eslint-disable-next-line no-bitwise -- shiki token metadata is a bitflag.
const isItalic = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 1) !== 0
// eslint-disable-next-line no-bitwise -- shiki token metadata is a bitflag.
const isBold = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 2) !== 0
// eslint-disable-next-line no-bitwise -- shiki token metadata is a bitflag.
const isUnderline = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 4) !== 0

function styleForLineRole(role: QualitySourceFrameLine['role']): LineRoleStyle {
  switch (role) {
    case 'failed':
      return {
        background: 'var(--qw-danger-soft)',
        accent: 'var(--qw-danger)',
        label: 'failed here',
        text: 'var(--qw-danger)',
        weight: 650,
      }
    case 'passed':
      return {
        background: 'var(--qw-ok-soft)',
        accent: 'var(--qw-ok)',
        label: 'passed here',
        text: 'var(--qw-ok)',
        weight: 650,
      }
    case 'not-evaluated':
      return {
        background: 'var(--qw-bg-muted)',
        accent: 'var(--qw-fg-faint)',
        label: 'not evaluated',
        text: 'var(--qw-fg-faint)',
        weight: 500,
      }
    case 'context':
      return {
        background: 'transparent',
        accent: 'transparent',
        label: null,
        text: 'var(--qw-fg-faint)',
        weight: 400,
      }
  }
}

function languageForFile(file: string): BundledLanguage {
  if (file.endsWith('.tsx')) return 'tsx'
  if (file.endsWith('.jsx')) return 'jsx'
  if (file.endsWith('.json')) return 'json'
  if (file.endsWith('.md') || file.endsWith('.mdx')) return 'markdown'
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return 'javascript'
  return 'typescript'
}

function createRawHighlight(code: string): HighlightedCode {
  return {
    bg: 'transparent',
    fg: 'inherit',
    tokens: code.split('\n').map((line) =>
      line === ''
        ? []
        : [
            {
              color: 'inherit',
              content: line,
              offset: 0,
            } satisfies ThemedToken,
          ],
    ),
  }
}

function Token({ token }: { token: ThemedToken }) {
  return (
    <span
      className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
      style={
        {
          backgroundColor: token.bgColor,
          color: token.color,
          fontStyle: isItalic(token.fontStyle) ? 'italic' : undefined,
          fontWeight: isBold(token.fontStyle) ? 'bold' : undefined,
          textDecoration: isUnderline(token.fontStyle) ? 'underline' : undefined,
          ...token.htmlStyle,
        } satisfies CSSProperties
      }
    >
      {token.content}
    </span>
  )
}

/** Render a backend-owned authored source-frame snapshot without inventing fallback source. */
export function SourceFrame({ frame }: { frame: QualitySourceFrame }) {
  if (frame.kind === 'unavailable') {
    return (
      <div
        data-source-frame="unavailable"
        className="flex items-start gap-2.5 rounded-[10px] px-4 py-3.5"
        style={{ background: 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
      >
        <Icon name="info" size={15} color="var(--qw-fg-muted)" />
        <div>
          <div className="text-[12.5px] font-semibold">Source frame unavailable</div>
          <div className="mt-[3px] text-[11.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
            {FRAME_UNAVAILABLE[frame.reason] ?? 'The authored source could not be resolved.'} The check evidence is
            still available below.
          </div>
        </div>
      </div>
    )
  }

  return <ResolvedSourceFrame frame={frame} />
}

function ResolvedSourceFrame({ frame }: { frame: Extract<QualitySourceFrame, { kind: 'source-frame' }> }) {
  const code = useMemo(() => frame.lines.map((line) => line.text).join('\n'), [frame.lines])
  const language = useMemo(() => languageForFile(frame.authoredFile), [frame.authoredFile])
  const rawHighlight = useMemo(() => createRawHighlight(code), [code])
  const [highlighted, setHighlighted] = useState<HighlightedCode>(() => highlightCode(code, language) ?? rawHighlight)
  const reconstructedDiskFrame = frame.resolver === 'disk' && frame.stale

  useEffect(() => {
    let cancelled = false
    setHighlighted(highlightCode(code, language) ?? rawHighlight)
    highlightCode(code, language, (result) => {
      if (!cancelled) setHighlighted(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, language, rawHighlight])

  return (
    <div>
      <div
        className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        <Icon name="doc" size={12} color="var(--qw-crux)" />
        <span style={{ color: 'var(--qw-fg-muted)', fontWeight: 650 }}>Source frame</span>
        <span>{frame.resolver}</span>
        <span>
          lines {frame.frameStartLine}-{frame.frameEndLine}
        </span>
      </div>
      {frame.stale && (
        <div
          className="flex items-center gap-2 rounded-t-[8px] px-3 py-2 text-[11.5px]"
          style={{
            background: 'var(--qw-warn-soft)',
            boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)',
            color: 'var(--qw-fg)',
          }}
        >
          <Icon name="alert" size={13} color="var(--qw-warn)" />
          {reconstructedDiskFrame ? (
            <span>
              This run stored a sourceRef but not a captured source snapshot, so this frame was reconstructed from the
              current file on disk. The line may differ from the exact code that ran.
            </span>
          ) : (
            <span>
              The eval file changed since this run (hash <span className="font-mono">{frame.contentHash}</span>). This
              is the source <b>as it was</b> when the cell ran; your editor may differ.
            </span>
          )}
        </div>
      )}
      <div
        data-source-frame="resolved"
        className="py-2.5 font-mono text-[12px] leading-[1.7]"
        style={{
          background: 'var(--qw-bg)',
          border: '1px solid var(--qw-border)',
          borderRadius: frame.stale ? '0 0 10px 10px' : 10,
        }}
      >
        {frame.lines.map((ln, index) => {
          const tone = styleForLineRole(ln.role)
          const marked = ln.role !== 'context'
          const tokens = highlighted.tokens[index] ?? []
          return (
            <div
              key={ln.line}
              data-source-frame-line={ln.line}
              data-source-frame-role={ln.role}
              className="flex gap-3.5 px-3 py-px"
              style={{
                background: tone.background,
                boxShadow: marked ? `inset 3px 0 0 ${tone.accent}` : 'none',
              }}
            >
              <span
                className="w-6 select-none text-right"
                style={{ color: marked ? tone.accent : 'var(--qw-fg-faint)', fontWeight: tone.weight }}
              >
                {ln.line}
              </span>
              <code
                className="flex-1 whitespace-pre"
                style={{ color: ln.role === 'not-evaluated' ? 'var(--qw-fg-faint)' : 'var(--qw-fg)' }}
              >
                {tokens.length > 0 ? tokens.map((token, tokenIndex) => <Token key={tokenIndex} token={token} />) : ' '}
              </code>
              {tone.label && (
                <span className="self-center whitespace-nowrap text-[10px] font-semibold" style={{ color: tone.text }}>
                  ← {tone.label}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
