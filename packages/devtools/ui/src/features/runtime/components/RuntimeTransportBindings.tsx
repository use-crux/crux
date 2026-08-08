/** Live managed-transport binding health for the Runtime inspect view. */

import { Chip } from "@/devtools/shell/primitives";
import type { RuntimeTransportBindingHealthRow } from "../types";

export function RuntimeTransportBindingsTable({
  rows,
}: {
  rows: readonly RuntimeTransportBindingHealthRow[];
}) {
  if (rows.length === 0) {
    return (
      <div
        className="px-4 py-6 text-[12px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        No managed-transport bindings in the generated Runtime program.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg-muted)",
            }}
          >
            <th className="px-4 py-2 font-medium">Binding</th>
            <th className="px-4 py-2 font-medium">Kind</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Cursor</th>
            <th className="px-4 py-2 font-medium">Accepted</th>
            <th className="px-4 py-2 font-medium">Fault</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.namespace}:${row.bindingId}`}
              style={{ borderBottom: "1px solid var(--devtools-border)" }}
            >
              <td className="px-4 py-2 font-mono">
                <div>{row.bindingId}</div>
                <div style={{ color: "var(--devtools-fg-faint)" }}>
                  {row.adapterId}
                </div>
              </td>
              <td className="px-4 py-2">
                <Chip tone="muted">{row.transportKind}</Chip>
              </td>
              <td className="px-4 py-2">
                <Chip
                  tone={
                    row.status === "faulted"
                      ? "danger"
                      : row.status === "disabled"
                        ? "warn"
                        : "ok"
                  }
                  dot
                >
                  {row.status}
                </Chip>
              </td>
              <td className="px-4 py-2 font-mono">
                {row.lease.ownerId ?? (
                  <span style={{ color: "var(--devtools-fg-faint)" }}>
                    {row.lease.coverage}
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                {row.cursor.present
                  ? row.cursor.ageMs !== undefined
                    ? `present · ${formatAge(row.cursor.ageMs)}`
                    : "present"
                  : row.cursor.coverage}
              </td>
              <td className="px-4 py-2 font-mono">
                {row.outcomes.coverage === "available"
                  ? String(row.outcomes.accepted ?? 0)
                  : row.outcomes.coverage}
              </td>
              <td className="px-4 py-2 font-mono">
                {row.fault.lastErrorCode ?? (
                  <span style={{ color: "var(--devtools-fg-faint)" }}>
                    {row.fault.coverage}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatAge(ageMs: number): string {
  if (ageMs < 1_000) {
    return `${ageMs}ms`;
  }
  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1_000)}s`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m`;
  }
  return `${Math.round(ageMs / 3_600_000)}h`;
}
