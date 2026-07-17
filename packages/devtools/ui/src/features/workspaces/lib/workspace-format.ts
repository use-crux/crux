import type { ChipTone } from "@/qw/shell/primitives";

export function fmtBytes(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fmtDuration(ms: number | undefined | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtTime(ms: number | undefined | null): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function fmtRelative(ms: number | undefined | null): string | null {
  if (ms == null) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return fmtTime(ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function shortTrace(id: string | undefined | null): string | null {
  if (!id) return null;
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}

export function shortPath(p: string, max = 60): string {
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
}

export function shortBreadcrumbId(id: string): string {
  if (id.length <= 36) return id;
  const colon = id.indexOf(":");
  if (colon > 0 && colon < 32) {
    return `${id.slice(0, colon + 1)}${id.slice(colon + 1, colon + 9)}…`;
  }
  return `${id.slice(0, 28)}…`;
}

export function opPillTone(op: string | undefined): { bg: string; fg: string } {
  switch (op) {
    case "write":
    case "delete":
      return { bg: "var(--qw-danger-soft)", fg: "var(--qw-danger)" };
    case "edit":
      return { bg: "var(--qw-warn-soft)", fg: "var(--qw-warn)" };
    case "list":
      return { bg: "var(--qw-iris-soft)", fg: "var(--qw-iris)" };
    case "read":
      return { bg: "var(--qw-ok-soft)", fg: "var(--qw-ok)" };
    default:
      return { bg: "var(--qw-bg-muted)", fg: "var(--qw-fg-muted)" };
  }
}

export function statusTone(status: string | undefined): ChipTone {
  if (status === "ok") return "ok";
  if (status === "err") return "danger";
  if (status === "denied") return "warn";
  return "muted";
}
