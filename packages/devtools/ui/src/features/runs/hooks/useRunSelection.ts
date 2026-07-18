import { useEffect, useMemo, useState } from "react";
import type { RunRow } from "../types";

export type SelectionState = "none" | "some" | "all";

export function useRunSelection(
  allRows: readonly RunRow[],
  visibleRows: readonly RunRow[],
) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function toggleSelected(traceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  useEffect(() => {
    if (selected.size === 0) return;
    const present = new Set(allRows.map((run) => run.traceId));
    let drift = false;
    const next = new Set<string>();
    for (const id of selected) {
      if (present.has(id)) next.add(id);
      else drift = true;
    }
    if (drift) setSelected(next);
  }, [allRows, selected]);

  const visibleSelectionState = useMemo<SelectionState>(() => {
    if (visibleRows.length === 0 || selected.size === 0) return "none";
    let count = 0;
    for (const run of visibleRows) if (selected.has(run.traceId)) count++;
    if (count === 0) return "none";
    return count === visibleRows.length ? "all" : "some";
  }, [selected, visibleRows]);

  function toggleAllVisible() {
    setSelected((prev) => {
      if (visibleSelectionState === "all") {
        const next = new Set(prev);
        for (const run of visibleRows) next.delete(run.traceId);
        return next;
      }
      const next = new Set(prev);
      for (const run of visibleRows) next.add(run.traceId);
      return next;
    });
  }

  return {
    selected,
    visibleSelectionState,
    toggleSelected,
    clearSelection,
    toggleAllVisible,
  };
}
