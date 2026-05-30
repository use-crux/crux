/**
 * Persistent left sidebar.
 *
 * Mounted once at the App level so it stays stable across route
 * swaps — the Suspense fallback for a navigating page replaces the
 * main column only, the nav stays interactive throughout. Same DOM
 * means view transitions also leave it alone (paired with the
 * `view-transition-name: qw-sidebar` CSS in `index.css`).
 *
 * Reads its own state (active view, connection status, theme) from
 * hooks instead of taking props. Pages that need to tweak chrome
 * (badge counts, port label) push to context rather than re-render
 * the sidebar.
 */

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Chip, CruxMark, type ChipTone } from './primitives'
import { Icon } from './Icon'
import { QW_NAV, type QwViewId } from './nav'
import { useTheme } from '@/app/theme/useTheme'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useNavigation } from '@/app/navigation/useNavigation'
import { navTarget } from '@/app/navigation/navTarget'

interface QwSidebarProps {
  /** Optional badges to render against specific nav items. */
  badges?: Partial<Record<QwViewId, { count: number; tone: ChipTone }>>
  /** Port label shown in the bottom status pill. */
  port?: number | string
  /** App label shown in the bottom status pill. */
  appLabel?: string
}

export function QwSidebar({ badges, port, appLabel }: QwSidebarProps) {
  const { theme, toggle } = useTheme()
  const connected = useConnected()
  const { nav, navigate } = useNavigation()
  const activeView = nav.view as QwViewId | 'scorers'

  return (
    <aside
      className="qw-sidebar flex w-[224px] flex-shrink-0 flex-col gap-4 px-3.5 pt-[18px] pb-3.5"
      style={{ borderRight: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      <div className="px-1.5">
        <CruxMark size={18} />
      </div>

      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('qw:open-search'))
        }}
        className="flex items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-[12px] transition-colors hover:opacity-90"
        style={{
          border: '1px solid var(--qw-border)',
          color: 'var(--qw-fg-muted)',
          background: 'var(--qw-bg-elev)',
        }}
      >
        <Icon name="search" size={13} />
        <span>Search traces, cases…</span>
        <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
          ⌘K
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {QW_NAV.map((group) => (
          <div key={group.id} className="flex flex-col gap-px">
            <div
              className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.16em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              {group.label}
            </div>
            {group.items.map((item) => (
              <SidebarItem
                key={item.id}
                iconName={item.iconName}
                label={item.label}
                active={activeView === item.id}
                badge={badges?.[item.id]}
                onClick={() => navigate(navTarget(item.id))}
              />
            ))}
          </div>
        ))}

        <div className="flex-1" />

        <div className="flex flex-col gap-px">
          <SidebarItem
            iconName="filter"
            label="Scorers & gates"
            active={activeView === 'scorers'}
            onClick={() => navigate(navTarget('scorers'))}
          />
        </div>

        <div
          className="rounded-[8px] p-2.5 text-[11px]"
          style={{
            border: '1px dashed var(--qw-crux-line)',
            color: 'var(--qw-fg-muted)',
            background: 'var(--qw-crux-soft)',
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: 'var(--qw-crux)' }}>
            <span
              className="size-1.5 rounded-full"
              style={{ background: connected ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
            />
            {connected ? 'Live' : 'Offline'}
            {port != null && <span className="opacity-80">· :{port}</span>}
          </div>
          {appLabel && <div className="font-mono text-[10.5px]">{appLabel}</div>}
        </div>

        <button
          type="button"
          onClick={toggle}
          className="flex items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11px] transition-opacity hover:opacity-100"
          style={{ color: 'var(--qw-fg-muted)', opacity: 0.7 }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}

// ─── Sidebar item ───────────────────────────────────────────────────

function SidebarItem({
  iconName,
  label,
  active,
  badge,
  onClick,
}: {
  iconName: Parameters<typeof Icon>[0]['name']
  label: string
  active: boolean
  badge?: { count: number; tone: ChipTone }
  onClick: () => void
}) {
  // Mirrors the inline `SidebarItem` that used to live inside QwShell —
  // keep visual parity exact so the hoist doesn't visibly change chrome.
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[13px] transition-colors',
        active ? 'font-semibold' : 'font-normal hover:opacity-90',
      )}
      style={{
        color: active ? 'var(--qw-crux)' : 'var(--qw-fg)',
        background: active ? 'var(--qw-crux-soft)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--qw-crux-line)' : undefined,
      }}
    >
      <Icon name={iconName} size={14} color={active ? 'var(--qw-crux)' : 'var(--qw-fg-muted)'} />
      <span className="truncate">{label}</span>
      {badge && (
        <Chip tone={badge.tone} mono className="ml-auto">
          {badge.count}
        </Chip>
      )}
    </button>
  )
}
