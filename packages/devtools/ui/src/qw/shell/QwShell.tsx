/**
 * Quality Workbench shell — main column only.
 *
 * The 224px left sidebar used to live inside this component; it has
 * been hoisted to `App.tsx` (via `<QwSidebar />`) so it stays mounted
 * across route swaps. Pages still call `<QwShell>` to render the
 * editorial chrome above their content:
 *  - Header — breadcrumb · title · subtitle · actions
 *  - Optional connection banner (auto)
 *  - Optional tab strip + optional filter bar above the page body
 */

import * as React from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { cn } from '@/shared/lib/utils'
import { Chip, type ChipTone } from './primitives'
import { Icon } from './Icon'
import { type QwViewId } from './nav'
import { ConnectionBanner } from './ConnectionBanner'
import { Breadcrumb } from './Breadcrumb'

/**
 * Subtle "refreshing" pill in the page header. Shows when any TanStack
 * Query is fetching in the background (initial loads are already covered
 * by Suspense fallbacks / per-section skeletons, so this is specifically
 * for background refetches kicked off by WS invalidations, window-focus,
 * mutations, etc.).
 *
 * Debounced: we only flip on after a short delay so quick refetches
 * (< 250 ms) don't flicker the indicator on and off.
 */
function RefreshIndicator() {
  const fetchingCount = useIsFetching()
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    if (fetchingCount > 0) {
      const t = window.setTimeout(() => setShow(true), 250)
      return () => window.clearTimeout(t)
    }
    setShow(false)
  }, [fetchingCount])
  if (!show) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-[2px] font-mono text-[10.5px]"
      style={{
        background: 'var(--qw-crux-soft)',
        color: 'var(--qw-crux)',
        border: '1px solid var(--qw-crux-line)',
      }}
      title={`Refreshing ${fetchingCount} ${fetchingCount === 1 ? 'query' : 'queries'} in the background`}
      aria-live="polite"
    >
      <span
        aria-hidden
        className="inline-block animate-running-pulse rounded-full"
        style={{ width: 6, height: 6, background: 'var(--qw-crux)' }}
      />
      refreshing
    </span>
  )
}

// ─── Tab definition ─────────────────────────────────────────────────

export interface QwTab {
  label: React.ReactNode
  active?: boolean
  count?: number | string | null
  iconName?: Parameters<typeof Icon>[0]['name']
  onClick?: () => void
}

// ─── Filter chip ────────────────────────────────────────────────────

export interface QwFilterChipDef {
  key: string
  value: string
  active?: boolean
  onRemove?: () => void
}

interface QwFilterBarProps {
  chips: readonly QwFilterChipDef[]
  right?: React.ReactNode
  onAdd?: () => void
}

export function QwFilterBar({ chips, right, onAdd }: QwFilterBarProps) {
  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-8 py-2"
      style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      <div
        className="mr-1 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        <Icon name="filter" size={11} />
        filter
      </div>
      {chips.map((c, i) => (
        <span
          key={`${c.key}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[3px] font-mono text-[11.5px]"
          style={{
            background: c.active ? 'var(--qw-crux-soft)' : 'var(--qw-bg-elev)',
            border: `1px solid ${c.active ? 'var(--qw-crux-line)' : 'var(--qw-border)'}`,
            color: c.active ? 'var(--qw-crux)' : 'var(--qw-fg)',
          }}
        >
          <span style={{ color: c.active ? 'var(--qw-crux)' : 'var(--qw-fg-muted)' }}>{c.key}:</span>
          <span className="font-medium">{c.value}</span>
          <button
            type="button"
            onClick={c.onRemove}
            className="opacity-70 hover:opacity-100"
            style={{ color: c.active ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
            aria-label={`Remove filter ${c.key}`}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[3px] font-mono text-[11.5px] transition-opacity hover:opacity-80"
        style={{
          color: 'var(--qw-fg-muted)',
          border: '1px dashed var(--qw-border)',
        }}
      >
        + filter
      </button>
      <div className="flex-1" />
      {right}
    </div>
  )
}

// ─── Shell ──────────────────────────────────────────────────────────
//
// The sidebar lived inline here until we hoisted it to `App.tsx` so it
// stays mounted across route swaps. See `QwSidebar.tsx`. QwShell now
// renders just the main column (header, banner, tabs, filter, body).

export interface QwShellProps {
  activeView: QwViewId | 'scorers'
  onNavigate: (view: QwViewId | 'scorers') => void
  breadcrumb?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  tabs?: readonly QwTab[]
  filterBar?: React.ReactNode
  badges?: Partial<Record<QwViewId, { count: number; tone: ChipTone }>>
  connected?: boolean
  appLabel?: string
  port?: number | string
  noScroll?: boolean
  onSearch?: () => void
  children: React.ReactNode
}

export function QwShell({
  activeView,
  onNavigate,
  breadcrumb,
  title,
  subtitle,
  actions,
  tabs,
  filterBar,
  badges,
  connected = false,
  appLabel,
  port,
  noScroll = false,
  onSearch,
  children,
}: QwShellProps) {
  // Suppress unused-prop warnings now that the sidebar is hoisted to
  // App.tsx. `activeView`, `onNavigate`, `badges`, `appLabel`, `port`,
  // `onSearch` and `connected` are kept on the API for backward
  // compatibility — every page still passes them — but they no longer
  // drive rendering here. (Sidebar reads its own state from hooks; the
  // ConnectionBanner reads `useConnected()` directly.)
  void activeView
  void onNavigate
  void badges
  void appLabel
  void port
  void onSearch
  void connected

  return (
    <main
      className="qw-page-content flex h-full min-w-0 flex-1 flex-col"
      style={{ background: 'var(--qw-bg)', color: 'var(--qw-fg)', fontFamily: 'var(--qw-sans)' }}
    >
      <header
        className="flex flex-shrink-0 items-end justify-between gap-5 px-8 pb-4 pt-5"
        style={{
          borderBottom: tabs ? 'none' : '1px solid var(--qw-border)',
          background: 'var(--qw-bg)',
        }}
      >
        <div className="min-w-0">
          {breadcrumb && (
            <div
              className="mb-1 font-mono text-[11px] uppercase tracking-[0.06em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              {typeof breadcrumb === 'string' ? <Breadcrumb text={breadcrumb} /> : breadcrumb}
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle && (
              <span className="text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {subtitle}
              </span>
            )}
            <RefreshIndicator />
          </div>
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <ConnectionBanner />

      {tabs && tabs.length > 0 && (
        <div
          className="flex flex-shrink-0 items-center gap-0 px-8 text-[12.5px]"
          style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
        >
          {tabs.map((tab, i) => (
            <button
              key={i}
              type="button"
              onClick={tab.onClick}
              className={cn(
                '-mb-px flex items-center gap-1.5 px-3.5 py-2.5',
                tab.active ? 'font-semibold' : 'font-normal hover:opacity-90',
              )}
              style={{
                color: tab.active ? 'var(--qw-fg)' : 'var(--qw-fg-muted)',
                borderBottom: tab.active ? '2px solid var(--qw-crux)' : '2px solid transparent',
              }}
            >
              {tab.iconName && (
                <Icon name={tab.iconName} size={13} color={tab.active ? 'var(--qw-crux)' : 'var(--qw-fg-faint)'} />
              )}
              {tab.label}
              {tab.count != null && (
                <span
                  className="rounded-[3px] px-[5px] py-px font-mono text-[10px]"
                  style={{
                    color: tab.active ? 'var(--qw-crux)' : 'var(--qw-fg-faint)',
                    background: tab.active ? 'var(--qw-crux-soft)' : 'var(--qw-bg-muted)',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {filterBar}

      <div
        className={cn('relative flex-1 min-h-0', noScroll ? 'overflow-hidden' : 'overflow-auto')}
        style={{ background: 'var(--qw-bg)' }}
      >
        {children}
      </div>
    </main>
  )
}
