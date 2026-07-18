import { CheckRow, PopoverSection } from "@/devtools/shell/FilterPopover";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import type { ColumnId } from "../types";
import {
  ALL_COLUMN_IDS,
  COLUMN_DEFS,
  DEFAULT_VISIBLE_COLUMNS,
  REQUIRED_COLUMNS,
} from "../lib/run-columns";

interface ColumnsButtonProps {
  visible: readonly ColumnId[];
  onChange: (next: readonly ColumnId[]) => void;
}

export function ColumnsButton({ visible, onChange }: ColumnsButtonProps) {
  const visibleSet = new Set(visible);

  function toggle(id: ColumnId) {
    if (REQUIRED_COLUMNS.includes(id)) return;
    const next = new Set(visibleSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(ALL_COLUMN_IDS.filter((column) => next.has(column)));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[6px] px-2 py-[4px] font-mono text-[11px] transition-opacity hover:opacity-80"
          style={{
            color: "var(--devtools-fg)",
            background: "transparent",
            boxShadow: "inset 0 0 0 1px var(--devtools-border)",
          }}
          title="Choose which columns to show"
        >
          columns
          <span style={{ color: "var(--devtools-fg-faint)" }}>
            · {visible.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[220px] p-0"
        style={{
          background: "var(--devtools-bg-elev)",
          border: "1px solid var(--devtools-border)",
        }}
      >
        <PopoverSection
          title={`Columns · ${visible.length}/${ALL_COLUMN_IDS.length}`}
        >
          {COLUMN_DEFS.map((column) => {
            const required = REQUIRED_COLUMNS.includes(column.id);
            const checked = visibleSet.has(column.id);
            return (
              <CheckRow
                key={column.id}
                checked={checked}
                label={
                  <span className="flex items-center gap-2">
                    <span>{column.label}</span>
                    {required && (
                      <span
                        className="font-mono text-[9.5px] uppercase tracking-[0.06em]"
                        style={{ color: "var(--devtools-fg-faint)" }}
                      >
                        required
                      </span>
                    )}
                  </span>
                }
                onClick={() => toggle(column.id)}
              />
            );
          })}
          <div
            className="flex items-center justify-between gap-2 px-3 py-2 font-mono text-[10.5px]"
            style={{
              borderTop: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg-muted)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                onChange(
                  ALL_COLUMN_IDS.filter((id) => REQUIRED_COLUMNS.includes(id)),
                )
              }
              className="hover:opacity-80"
            >
              Hide all
            </button>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_VISIBLE_COLUMNS)}
              className="hover:opacity-80"
              style={{ color: "var(--devtools-fg)" }}
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={() => onChange(ALL_COLUMN_IDS)}
              className="hover:opacity-80"
              style={{ color: "var(--devtools-crux)" }}
            >
              Show all
            </button>
          </div>
        </PopoverSection>
      </PopoverContent>
    </Popover>
  );
}
