/**
 * ValueView — smart renderer for an arbitrary value (input/output/expected
 * payloads, baseline outputs, …).
 *
 * It sniffs the content and picks a sensible default view, with a small toggle
 * to switch:
 *   - text      → rendered as-is (serif, whitespace preserved). No toggle.
 *   - markdown  → rendered (Streamdown) ⇄ raw
 *   - json      → tree (collapsible, colorized) ⇄ [table, when tabular] ⇄ raw
 *
 * Detection is intentionally conservative: strings only become JSON when they
 * actually parse to an object/array, and only become markdown when a real
 * marker is present — otherwise they stay plain text. Pass `bare` to drop the
 * bordered card (e.g. when the caller already provides one).
 */

import * as React from "react";
import { Streamdown } from "streamdown";
import { JsonTree } from "./JsonTree";

type Kind = "text" | "markdown" | "json";

interface Detected {
  kind: Kind;
  text: string;
  data?: unknown;
}

const MARKDOWN_MARKERS: readonly RegExp[] = [
  /^#{1,6}\s/m, // heading
  /^\s*[-*+]\s+\S/m, // bullet list
  /^\s*\d+\.\s+\S/m, // ordered list
  /^>\s/m, // blockquote
  /```/, // fenced code
  /\[[^\]]+\]\([^)]+\)/, // link
  /\*\*[^*\n]+\*\*/, // bold
  /^\|.+\|\s*$/m, // table row
];

function looksMarkdown(s: string): boolean {
  return MARKDOWN_MARKERS.some((re) => re.test(s));
}

/** Sniff a value into one of the three render kinds. */
function detect(value: unknown): Detected {
  if (value != null && typeof value === "object") {
    return { kind: "json", text: safeStringify(value), data: value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed && (trimmed[0] === "{" || trimmed[0] === "[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed != null && typeof parsed === "object") {
          return { kind: "json", text: value, data: parsed };
        }
      } catch {
        // not JSON — fall through
      }
    }
    if (looksMarkdown(value)) return { kind: "markdown", text: value };
    return { kind: "text", text: value };
  }
  // numbers, booleans, null/undefined
  return { kind: "text", text: value == null ? "—" : String(value) };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type TableShape =
  | { kind: "rows"; rows: Record<string, unknown>[] } // array of objects → columns
  | { kind: "kv"; entries: [string, unknown][] }; // single object → field/value

/** Whether JSON can be shown as a table — array of objects, or a single object. */
function tableShape(data: unknown): TableShape | null {
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    if (
      !data.every(
        (r) => r != null && typeof r === "object" && !Array.isArray(r),
      )
    )
      return null;
    return { kind: "rows", rows: data as Record<string, unknown>[] };
  }
  if (data != null && typeof data === "object") {
    const entries = Object.entries(data);
    if (entries.length > 0) return { kind: "kv", entries };
  }
  return null;
}

export function ValueView({
  value,
  label,
  tone,
  bare = false,
  className,
}: {
  value: unknown;
  label?: React.ReactNode;
  tone?: "danger";
  bare?: boolean;
  className?: string;
}) {
  const det = React.useMemo(() => detect(value), [value]);
  const table = React.useMemo(
    () => (det.kind === "json" ? tableShape(det.data) : null),
    [det],
  );

  const modes = React.useMemo<string[]>(() => {
    if (det.kind === "markdown") return ["rendered", "raw"];
    if (det.kind === "json")
      return table ? ["tree", "table", "raw"] : ["tree", "raw"];
    return ["text"];
  }, [det.kind, table]);

  // `mode` is uncontrolled-with-reset: if the stored choice isn't valid for the
  // current value (it changed kind), fall back to the first mode.
  const [picked, setPicked] = React.useState<string | null>(null);
  const mode = picked && modes.includes(picked) ? picked : modes[0];

  const content = (
    <div className="max-h-[440px] overflow-auto">
      {det.kind === "text" && (
        <div
          className="whitespace-pre-wrap break-words"
          style={{
            fontFamily: "var(--qw-serif)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {det.text}
        </div>
      )}
      {det.kind === "markdown" &&
        (mode === "rendered" ? (
          <div className="qw-prose">
            <Streamdown>{det.text}</Streamdown>
          </div>
        ) : (
          <RawText text={det.text} />
        ))}
      {det.kind === "json" &&
        (mode === "table" && table ? (
          <JsonTable shape={table} />
        ) : mode === "raw" ? (
          <RawText text={safeStringify(det.data)} />
        ) : (
          <JsonTree data={det.data} />
        ))}
    </div>
  );

  const showToolbar = Boolean(label) || modes.length > 1;
  const toolbar = showToolbar && (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      {label ? (
        <span
          className="font-mono text-[10px] uppercase tracking-[0.1em]"
          style={{ color: "var(--qw-fg-faint)" }}
        >
          {label}
        </span>
      ) : (
        <span />
      )}
      {modes.length > 1 && (
        <ModeToggle modes={modes} active={mode} onChange={setPicked} />
      )}
    </div>
  );

  if (bare) {
    return (
      <div className={className}>
        {toolbar}
        {content}
      </div>
    );
  }
  return (
    <div className={className}>
      {toolbar}
      <div
        className="rounded-[8px] px-3 py-2.5"
        style={{
          background: "var(--qw-bg)",
          boxShadow: `inset 0 0 0 1px ${tone === "danger" ? "var(--qw-danger-line)" : "var(--qw-border)"}`,
        }}
      >
        {content}
      </div>
    </div>
  );
}

function RawText({ text }: { text: string }) {
  return (
    <pre
      className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6]"
      style={{ color: "var(--qw-fg)" }}
    >
      {text}
    </pre>
  );
}

function ModeToggle({
  modes,
  active,
  onChange,
}: {
  modes: string[];
  active: string;
  onChange: (m: string) => void;
}) {
  return (
    <span
      className="inline-flex overflow-hidden rounded-[6px] font-mono text-[10px]"
      style={{
        border: "1px solid var(--qw-border)",
        background: "var(--qw-bg)",
      }}
    >
      {modes.map((m) => {
        const on = m === active;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className="px-2 py-[3px] lowercase"
            style={{
              color: on ? "var(--qw-crux)" : "var(--qw-fg-muted)",
              background: on ? "var(--qw-crux-soft)" : "transparent",
            }}
          >
            {m}
          </button>
        );
      })}
    </span>
  );
}

const TH = "px-2.5 py-1.5 text-left font-semibold";
const TH_STYLE = {
  color: "var(--qw-fg-muted)",
  background: "var(--qw-bg-muted)",
  borderBottom: "1px solid var(--qw-border)",
} as const;
const TD_STYLE = {
  borderBottom: "1px solid var(--qw-border)",
  color: "var(--qw-fg)",
} as const;

function JsonTable({ shape }: { shape: TableShape }) {
  if (shape.kind === "kv") {
    // Single object → two-column field/value table.
    return (
      <table className="w-full border-collapse font-mono text-[11.5px]">
        <tbody>
          {shape.entries.map(([k, v]) => (
            <tr key={k}>
              <th
                className="w-[180px] px-2.5 py-1.5 text-left align-top font-semibold"
                style={TD_STYLE}
              >
                <span style={{ color: "var(--qw-iris)" }}>{k}</span>
              </th>
              <td className="px-2.5 py-1.5 align-top" style={TD_STYLE}>
                {cellText(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  // Array of objects → columnar table keyed by the union of fields.
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of shape.rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) (seen.add(k), cols.push(k));
  return (
    <table className="w-full border-collapse font-mono text-[11.5px]">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} className={TH} style={TH_STYLE}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shape.rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c} className="px-2.5 py-1.5 align-top" style={TD_STYLE}>
                {cellText(r[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellText(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return safeStringify(v);
  return String(v);
}
