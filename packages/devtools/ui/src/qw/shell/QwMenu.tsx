/**
 * Quality Workbench dropdown menu wrapper.
 *
 * Re-skins shadcn's DropdownMenu to the QW palette and exposes two
 * convenience presets used across the filter bars:
 *
 *  - `<QwGroupBy>` — group-by dropdown, single radio selection
 *  - `<QwAddFilterMenu>` — "+ filter" button + menu of available kinds
 *
 * The lower-level primitives (`QwMenuRoot`, `QwMenuItem`, `QwMenuSection`)
 * are re-exports of the shadcn dropdown menu with default class names
 * threaded through, so screens that need richer menus (separators,
 * checkbox items, sub-menus) can use them directly.
 */

import { type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Icon } from "./Icon";
import { Chip } from "./primitives";

const CONTENT_STYLE: React.CSSProperties = {
  background: "var(--qw-bg-elev)",
  color: "var(--qw-fg)",
  border: "1px solid var(--qw-border)",
  fontFamily: "var(--qw-mono)",
  fontSize: 11.5,
  borderRadius: 8,
  padding: 4,
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
  minWidth: 200,
};

const LABEL_STYLE: React.CSSProperties = {
  color: "var(--qw-fg-faint)",
  fontFamily: "var(--qw-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  padding: "6px 10px 4px",
};

const ITEM_STYLE: React.CSSProperties = {
  color: "var(--qw-fg)",
  fontFamily: "var(--qw-mono)",
  fontSize: 11.5,
  padding: "6px 10px",
  borderRadius: 4,
  cursor: "pointer",
};

// ─── Re-exports for richer cases ────────────────────────────────────

export {
  DropdownMenu as QwMenuRoot,
  DropdownMenuTrigger as QwMenuTrigger,
  DropdownMenuSeparator as QwMenuSeparator,
};

export function QwMenuContent({
  align = "end",
  children,
  ...rest
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent align={align} style={CONTENT_STYLE} {...rest}>
      {children}
    </DropdownMenuContent>
  );
}

export function QwMenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenuLabel style={LABEL_STYLE}>{children}</DropdownMenuLabel>;
}

export function QwMenuItem({
  children,
  onSelect,
  disabled,
  hint,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      style={ITEM_STYLE}
      className="qw-menu-item"
    >
      <span>{children}</span>
      {hint && (
        <span style={{ marginLeft: "auto", color: "var(--qw-fg-faint)" }}>
          {hint}
        </span>
      )}
    </DropdownMenuItem>
  );
}

// ─── Group-by preset ────────────────────────────────────────────────

export function QwGroupBy<G extends string>({
  value,
  options,
  onChange,
  label = "group by",
}: {
  value: G;
  options: ReadonlyArray<{ value: G; label: string }>;
  onChange: (next: G) => void;
  label?: string;
}) {
  const cur = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] hover:opacity-80"
          style={{ color: "var(--qw-fg-muted)" }}
        >
          {label} ·{" "}
          <span style={{ color: "var(--qw-fg)" }}>{cur?.label ?? value}</span>
          <Icon name="arrowDown" size={10} color="var(--qw-fg-muted)" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" style={CONTENT_STYLE}>
        <DropdownMenuLabel style={LABEL_STYLE}>Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as G)}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem
              key={o.value}
              value={o.value}
              style={{
                ...ITEM_STYLE,
                paddingLeft: 28,
              }}
              className="qw-menu-radio"
            >
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Add-filter preset ──────────────────────────────────────────────

export interface QwAddFilterItem<K extends string> {
  kind: K;
  label: string;
  enabled: boolean;
}

export function QwAddFilterMenu<K extends string>({
  options,
  onAdd,
}: {
  options: ReadonlyArray<QwAddFilterItem<K>>;
  onAdd: (kind: K) => void;
}) {
  const anyEnabled = options.some((o) => o.enabled);
  if (!anyEnabled) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[3px] font-mono text-[11.5px] transition-opacity hover:opacity-80"
          style={{
            color: "var(--qw-fg-muted)",
            border: "1px dashed var(--qw-border)",
          }}
        >
          + filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" style={CONTENT_STYLE}>
        <DropdownMenuLabel style={LABEL_STYLE}>Add filter</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.kind}
            disabled={!o.enabled}
            onSelect={() => o.enabled && onAdd(o.kind)}
            style={{
              ...ITEM_STYLE,
              opacity: o.enabled ? 1 : 0.45,
              cursor: o.enabled ? "pointer" : "not-allowed",
            }}
            className="qw-menu-item"
          >
            <span>{o.label}</span>
            {!o.enabled && (
              <Chip tone="muted" className="ml-auto">
                active
              </Chip>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
