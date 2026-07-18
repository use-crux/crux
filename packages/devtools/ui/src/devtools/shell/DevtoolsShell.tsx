/**
 * Devtools shell — main column only.
 *
 * The responsive left sidebar lives in `App.tsx` (via `<DevtoolsSidebar />`)
 * so it stays mounted across route swaps. Pages call `<DevtoolsShell>` to
 * render the
 * editorial chrome above their content:
 *  - Header — breadcrumb · title · subtitle · actions
 *  - Optional connection banner (auto)
 *  - Optional tab strip + optional filter bar above the page body
 */

import * as React from "react";
import { useIsFetching } from "@tanstack/react-query";
import { cn } from "@/shared/lib/utils";
import { Chip } from "./primitives";
import { Icon } from "./Icon";
import { ConnectionBanner } from "./ConnectionBanner";
import { Breadcrumb } from "./Breadcrumb";

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
  const fetchingCount = useIsFetching();
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (fetchingCount > 0) {
      const t = window.setTimeout(() => setShow(true), 250);
      return () => window.clearTimeout(t);
    }
    setShow(false);
  }, [fetchingCount]);
  if (!show) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-[2px] font-mono text-[10.5px]"
      style={{
        background: "var(--devtools-crux-soft)",
        color: "var(--devtools-crux)",
        border: "1px solid var(--devtools-crux-line)",
      }}
      title={`Refreshing ${fetchingCount} ${fetchingCount === 1 ? "query" : "queries"} in the background`}
      aria-live="polite"
    >
      <span
        aria-hidden
        className="inline-block animate-running-pulse rounded-full"
        style={{ width: 6, height: 6, background: "var(--devtools-crux)" }}
      />
      refreshing
    </span>
  );
}

// ─── Tab definition ─────────────────────────────────────────────────

export interface DevtoolsTab {
  label: React.ReactNode;
  active?: boolean;
  count?: number | string | null;
  iconName?: Parameters<typeof Icon>[0]["name"];
  onClick?: () => void;
}

// ─── Filter chip ────────────────────────────────────────────────────

export interface DevtoolsFilterChipDef {
  key: string;
  value: string;
  active?: boolean;
  onRemove?: () => void;
}

interface DevtoolsFilterBarProps {
  chips: readonly DevtoolsFilterChipDef[];
  right?: React.ReactNode;
  onAdd?: () => void;
}

export function DevtoolsFilterBar({
  chips,
  right,
  onAdd,
}: DevtoolsFilterBarProps) {
  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-8 py-2"
      style={{
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <div
        className="mr-1 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        <Icon name="filter" size={11} />
        filter
      </div>
      {chips.map((c, i) => (
        <span
          key={`${c.key}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[3px] font-mono text-[11.5px]"
          style={{
            background: c.active
              ? "var(--devtools-crux-soft)"
              : "var(--devtools-bg-elev)",
            border: `1px solid ${c.active ? "var(--devtools-crux-line)" : "var(--devtools-border)"}`,
            color: c.active ? "var(--devtools-crux)" : "var(--devtools-fg)",
          }}
        >
          <span
            style={{
              color: c.active
                ? "var(--devtools-crux)"
                : "var(--devtools-fg-muted)",
            }}
          >
            {c.key}:
          </span>
          <span className="font-medium">{c.value}</span>
          <button
            type="button"
            onClick={c.onRemove}
            className="opacity-70 hover:opacity-100"
            style={{
              color: c.active
                ? "var(--devtools-crux)"
                : "var(--devtools-fg-faint)",
            }}
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
          color: "var(--devtools-fg-muted)",
          border: "1px dashed var(--devtools-border)",
        }}
      >
        + filter
      </button>
      <div className="flex-1" />
      {right}
    </div>
  );
}

// ─── Shell ──────────────────────────────────────────────────────────
//
// The sidebar lived inline here until we hoisted it to `App.tsx` so it
// stays mounted across route swaps. See `DevtoolsSidebar.tsx`. DevtoolsShell now
// renders just the main column (header, banner, tabs, filter, body).

export interface DevtoolsShellProps {
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: readonly DevtoolsTab[];
  filterBar?: React.ReactNode;
  noScroll?: boolean;
  children: React.ReactNode;
}

export function DevtoolsShell({
  breadcrumb,
  title,
  subtitle,
  actions,
  tabs,
  filterBar,
  noScroll = false,
  children,
}: DevtoolsShellProps) {
  return (
    <main
      className="devtools-page-content flex h-full min-w-0 flex-1 flex-col"
      style={{
        background: "var(--devtools-bg)",
        color: "var(--devtools-fg)",
        fontFamily: "var(--devtools-sans)",
      }}
    >
      <header
        className="flex flex-shrink-0 items-end justify-between gap-5 px-8 pb-4 pt-5"
        style={{
          borderBottom: tabs ? "none" : "1px solid var(--devtools-border)",
          background: "var(--devtools-bg)",
        }}
      >
        <div className="min-w-0">
          {breadcrumb && (
            <div
              className="mb-1 font-mono text-[11px] uppercase tracking-[0.06em]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              {typeof breadcrumb === "string" ? (
                <Breadcrumb text={breadcrumb} />
              ) : (
                breadcrumb
              )}
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            {subtitle && (
              <span
                className="text-[13px]"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                {subtitle}
              </span>
            )}
            <RefreshIndicator />
          </div>
        </div>
        {actions && (
          <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>

      <ConnectionBanner />

      {tabs && tabs.length > 0 && (
        <div
          className="flex flex-shrink-0 items-center gap-0 px-8 text-[12.5px]"
          style={{
            borderBottom: "1px solid var(--devtools-border)",
            background: "var(--devtools-bg)",
          }}
        >
          {tabs.map((tab, i) => (
            <button
              key={i}
              type="button"
              onClick={tab.onClick}
              className={cn(
                "-mb-px flex items-center gap-1.5 px-3.5 py-2.5",
                tab.active ? "font-semibold" : "font-normal hover:opacity-90",
              )}
              style={{
                color: tab.active
                  ? "var(--devtools-fg)"
                  : "var(--devtools-fg-muted)",
                borderBottom: tab.active
                  ? "2px solid var(--devtools-crux)"
                  : "2px solid transparent",
              }}
            >
              {tab.iconName && (
                <Icon
                  name={tab.iconName}
                  size={13}
                  color={
                    tab.active
                      ? "var(--devtools-crux)"
                      : "var(--devtools-fg-faint)"
                  }
                />
              )}
              {tab.label}
              {tab.count != null && (
                <span
                  className="rounded-[3px] px-[5px] py-px font-mono text-[10px]"
                  style={{
                    color: tab.active
                      ? "var(--devtools-crux)"
                      : "var(--devtools-fg-faint)",
                    background: tab.active
                      ? "var(--devtools-crux-soft)"
                      : "var(--devtools-bg-muted)",
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
        className={cn(
          "relative flex-1 min-h-0",
          noScroll ? "overflow-hidden" : "overflow-auto",
        )}
        style={{ background: "var(--devtools-bg)" }}
      >
        {children}
      </div>
    </main>
  );
}
