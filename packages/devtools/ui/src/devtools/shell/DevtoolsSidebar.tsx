/**
 * Persistent left sidebar.
 *
 * Mounted once at the App level so it stays stable across route
 * swaps — the Suspense fallback for a navigating page replaces the
 * main column only, the nav stays interactive throughout. Same DOM
 * means view transitions also leave it alone (paired with the
 * `view-transition-name: devtools-sidebar` CSS in `index.css`).
 *
 * Reads its own state (active view, connection status, theme) from
 * hooks instead of taking props. Pages that need to tweak chrome
 * (badge counts, port label) push to context rather than re-render
 * the sidebar.
 */

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Chip, CruxMark, type ChipTone } from "./primitives";
import { Icon } from "./Icon";
import { DEVTOOLS_NAV, type DevtoolsViewId } from "./nav";
import { useTheme } from "@/app/theme/useTheme";
import { useConnected } from "@/app/runtime/runtimeStore";
import { useNavigation } from "@/app/navigation/useNavigation";
import { navTarget, sidebarIdForView } from "@/app/navigation/navTarget";

interface DevtoolsSidebarProps {
  /** Optional badges to render against specific nav items. */
  badges?: Partial<Record<DevtoolsViewId, { count: number; tone: ChipTone }>>;
  /** Port label shown in the bottom status pill. */
  port?: number | string;
  /** App label shown in the bottom status pill. */
  appLabel?: string;
}

export function DevtoolsSidebar({
  badges,
  port,
  appLabel,
}: DevtoolsSidebarProps) {
  const { theme, toggle } = useTheme();
  const connected = useConnected();
  const { nav, navigate } = useNavigation();
  // Resolve the owning sidebar item so detail/drilldown screens
  // (e.g. Eval detail or run detail) keep their parent menu item
  // highlighted instead of leaving nothing active.
  const activeView = sidebarIdForView(nav.view);

  return (
    <aside
      className="devtools-sidebar flex w-[56px] flex-shrink-0 flex-col gap-2 px-2 pt-[18px] pb-3.5 sm:w-[224px] sm:gap-4 sm:px-3.5"
      style={{
        borderRight: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <div className="mx-auto w-[18px] overflow-hidden sm:mx-0 sm:w-auto sm:overflow-visible sm:px-1.5">
        <CruxMark size={18} />
      </div>

      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("devtools:open-search"));
        }}
        aria-label="Search traces and cases"
        className="flex items-center justify-center gap-2 rounded-[8px] px-2 py-[7px] text-[12px] transition-colors hover:opacity-90 sm:justify-start sm:px-2.5"
        style={{
          border: "1px solid var(--devtools-border)",
          color: "var(--devtools-fg-muted)",
          background: "var(--devtools-bg-elev)",
        }}
      >
        <Icon name="search" size={13} />
        <span className="hidden sm:inline">Search traces, cases…</span>
        <span
          className="ml-auto hidden font-mono text-[10px] sm:inline"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          ⌘K
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {DEVTOOLS_NAV.map((group) => (
          <div key={group.id} className="flex flex-col gap-px">
            <div
              className="hidden px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] sm:block"
              style={{ color: "var(--devtools-fg-faint)" }}
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

        <div
          className="flex items-center justify-center rounded-[8px] p-2 text-[11px] sm:block sm:p-2.5"
          style={{
            border: "1px dashed var(--devtools-crux-line)",
            color: "var(--devtools-fg-muted)",
            background: "var(--devtools-crux-soft)",
          }}
          title={connected ? "Live" : "Offline"}
          aria-label={connected ? "Live" : "Offline"}
        >
          <div
            className="flex items-center gap-1.5 font-semibold sm:mb-1"
            style={{ color: "var(--devtools-crux)" }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{
                background: connected
                  ? "var(--devtools-crux)"
                  : "var(--devtools-fg-faint)",
              }}
            />
            <span className="hidden sm:inline">
              {connected ? "Live" : "Offline"}
            </span>
            {port != null && (
              <span className="hidden opacity-80 sm:inline">· :{port}</span>
            )}
          </div>
          {appLabel && (
            <div className="hidden font-mono text-[10.5px] sm:block">
              {appLabel}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggle}
          className="flex items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11px] transition-opacity hover:opacity-100"
          style={{ color: "var(--devtools-fg-muted)", opacity: 0.7 }}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Sun className="size-3.5" />
          ) : (
            <Moon className="size-3.5" />
          )}
          <span className="hidden sm:inline">
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </span>
        </button>
      </div>
    </aside>
  );
}

// ─── Sidebar item ───────────────────────────────────────────────────

export function SidebarItem({
  iconName,
  label,
  active,
  badge,
  onClick,
}: {
  iconName: Parameters<typeof Icon>[0]["name"];
  label: string;
  active: boolean;
  badge?: { count: number; tone: ChipTone };
  onClick: () => void;
}) {
  // Mirrors the inline `SidebarItem` that used to live inside DevtoolsShell —
  // keep visual parity exact so the hoist doesn't visibly change chrome.
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-2.5 rounded-[6px] px-2 py-[7px] text-[13px] transition-colors sm:justify-start sm:px-2.5",
        active ? "font-semibold" : "font-normal hover:opacity-90",
      )}
      style={{
        color: active ? "var(--devtools-crux)" : "var(--devtools-fg)",
        background: active ? "var(--devtools-crux-soft)" : "transparent",
        boxShadow: active
          ? "inset 0 0 0 1px var(--devtools-crux-line)"
          : undefined,
      }}
    >
      <Icon
        name={iconName}
        size={14}
        color={active ? "var(--devtools-crux)" : "var(--devtools-fg-muted)"}
      />
      <span className="hidden truncate sm:block">{label}</span>
      {badge && (
        <Chip tone={badge.tone} mono className="ml-auto hidden sm:inline-flex">
          {badge.count}
        </Chip>
      )}
    </button>
  );
}
