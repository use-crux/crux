import type { ColumnDef, ColumnId } from "../types";

export const COLUMN_DEFS: readonly ColumnDef[] = [
  { id: "kind", label: "kind", width: "78px" },
  { id: "status", label: "status", width: "88px" },
  { id: "trace", label: "trace", width: "76px" },
  { id: "target", label: "target", width: "minmax(180px, 1fr)" },
  { id: "model", label: "model", width: "130px" },
  { id: "provider", label: "provider", width: "92px" },
  { id: "dur", label: "dur", width: "70px", align: "right" },
  { id: "tokens", label: "tokens", width: "80px", align: "right" },
  { id: "cost", label: "cost", width: "70px", align: "right" },
  { id: "score", label: "score", width: "70px", align: "right" },
  { id: "tools", label: "tools", width: "60px", align: "right" },
  { id: "spans", label: "graph", width: "96px", align: "right" },
  { id: "session", label: "session", width: "90px" },
  { id: "error", label: "error", width: "minmax(160px, 1fr)" },
  { id: "time", label: "time", width: "78px", align: "right" },
];

export const ALL_COLUMN_IDS: readonly ColumnId[] = COLUMN_DEFS.map((c) => c.id);
export const REQUIRED_COLUMNS: readonly ColumnId[] = ["status", "target"];

export const DEFAULT_VISIBLE_COLUMNS: readonly ColumnId[] = [
  "kind",
  "status",
  "target",
  "model",
  "dur",
  "tokens",
  "cost",
  "spans",
  "score",
  "time",
];

const LOCAL_STORAGE_KEY = "qw:runs:cols";

export function loadVisibleColumns(): readonly ColumnId[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE_COLUMNS;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const ids = raw
      .split(",")
      .filter((s): s is ColumnId =>
        (ALL_COLUMN_IDS as readonly string[]).includes(s),
      );
    const set = new Set<ColumnId>(ids);
    for (const required of REQUIRED_COLUMNS) set.add(required);
    return ALL_COLUMN_IDS.filter((id) => set.has(id));
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
}

export function saveVisibleColumns(ids: readonly ColumnId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, ids.join(","));
  } catch {
    // Ignore quota / privacy mode.
  }
}

export function gridTemplateFor(visible: readonly ColumnId[]): string {
  const visibleSet = new Set(visible);
  const tracks = COLUMN_DEFS.filter((c) => visibleSet.has(c.id)).map(
    (c) => c.width,
  );
  return ["36px", ...tracks].join(" ");
}
