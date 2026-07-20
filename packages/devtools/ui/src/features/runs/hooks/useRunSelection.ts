import { useEffect, useMemo, useState } from "react";
import type { RunRow } from "../types";

export type SelectionState = "none" | "some" | "all";

export function useRunSelection(
  allRows: readonly RunRow[],
  visibleRows: readonly RunRow[],
) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function toggleSelected(operationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  useEffect(() => {
    if (selected.size === 0) return;
    const present = new Set(allRows.map((run) => run.operationId));
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
    for (const run of visibleRows) if (selected.has(run.operationId)) count++;
    if (count === 0) return "none";
    return count === visibleRows.length ? "all" : "some";
  }, [selected, visibleRows]);

  function toggleAllVisible() {
    setSelected((prev) => {
      if (visibleSelectionState === "all") {
        const next = new Set(prev);
        for (const run of visibleRows) next.delete(run.operationId);
        return next;
      }
      const next = new Set(prev);
      for (const run of visibleRows) next.add(run.operationId);
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
