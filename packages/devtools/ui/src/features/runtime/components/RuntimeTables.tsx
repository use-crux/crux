import { Chip, Btn } from "@/devtools/shell/primitives";
import type React from "react";
import { Icon } from "@/devtools/shell/Icon";
import { fmtRuntimeDate, runtimeStatusTone } from "../lib/runtime-format";
import type {
  RuntimeOutboxRow,
  RuntimeTimerRow,
  RuntimeWorkRow,
} from "../types";
export { RuntimeWorkDetail } from "./RuntimeWorkDetail";

interface RuntimeWorkTableProps {
  rows: readonly RuntimeWorkRow[];
  selectedWorkId?: string;
  retrying?: boolean;
  cancelling?: boolean;
  onSelect: (workId: string) => void;
  onRetry: (workId: string) => void;
  onCancel: (workId: string) => void;
}

export function RuntimeWorkTable({
  rows,
  selectedWorkId,
  retrying,
  cancelling,
  onSelect,
  onRetry,
  onCancel,
}: RuntimeWorkTableProps) {
  if (rows.length === 0)
    return (
      <EmptyRuntimeRows label="No work items match the current filters." />
    );
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
        <thead style={{ color: "var(--devtools-fg-faint)" }}>
          <tr
            className="border-b"
            style={{ borderColor: "var(--devtools-border)" }}
          >
            <Th>status</Th>
            <Th>work</Th>
            <Th>target</Th>
            <Th>attempts</Th>
            <Th>updated</Th>
            <Th>next</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const retryable =
              row.status === "blocked" || row.status === "dead-letter";
            const cancellable = ![
              "completed",
              "cancelled",
              "blocked",
              "dead-letter",
            ].includes(row.status);
            return (
              <tr
                key={row.workId}
                className="border-b transition-colors"
                style={{
                  borderColor: "var(--devtools-border)",
                  background:
                    row.workId === selectedWorkId
                      ? "var(--devtools-crux-soft)"
                      : "transparent",
                }}
              >
                <Td>
                  <Chip tone={runtimeStatusTone(row.status)} mono dot>
                    {row.status}
                  </Chip>
                </Td>
                <Td>
                  <button
                    type="button"
                    className="font-mono hover:underline"
                    style={{ color: "var(--devtools-fg)" }}
                    onClick={() => onSelect(row.workId)}
                  >
                    {row.workId}
                  </button>
                  <div
                    className="mt-0.5 font-mono text-[10.5px]"
                    style={{ color: "var(--devtools-fg-faint)" }}
                  >
                    {row.work.kind}
                  </div>
                  {row.application?.progress?.message && (
                    <div
                      className="mt-0.5 max-w-64 truncate text-[10.5px]"
                      style={{ color: "var(--devtools-fg-muted)" }}
                    >
                      {row.application.progress.message}
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="font-mono">{row.targetId}</div>
                  <div
                    className="mt-0.5 font-mono text-[10.5px]"
                    style={{ color: "var(--devtools-fg-faint)" }}
                  >
                    {row.namespace}
                  </div>
                </Td>
                <Td>
                  {row.attempt}/{row.maxAttempts}
                </Td>
                <Td>{fmtRuntimeDate(row.updatedAt)}</Td>
                <Td>{fmtRuntimeDate(row.notBefore)}</Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Btn
                      size="xs"
                      variant="soft"
                      icon={<Icon name="loop" size={11} />}
                      disabled={!retryable || retrying}
                      onClick={() => onRetry(row.workId)}
                    >
                      Retry
                    </Btn>
                    <Btn
                      size="xs"
                      variant="danger"
                      icon={<Icon name="x" size={11} />}
                      disabled={!cancellable || cancelling}
                      onClick={() => onCancel(row.workId)}
                    >
                      Cancel
                    </Btn>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RuntimeTimerTable({
  rows,
}: {
  rows: readonly RuntimeTimerRow[];
}) {
  if (rows.length === 0) return <EmptyRuntimeRows label="No timers found." />;
  return (
    <SimpleTable
      columns={["state", "timer", "work", "fires", "scope"]}
      rows={rows.map((row) => [
        <Chip
          key="state"
          tone={
            row.state === "scheduled"
              ? "warn"
              : row.state === "fired"
                ? "ok"
                : "muted"
          }
          mono
          dot
        >
          {row.state}
        </Chip>,
        <Mono key="timer">{row.timerId}</Mono>,
        <Mono key="work">{row.workId ?? row.work.kind}</Mono>,
        fmtRuntimeDate(row.fireAt),
        row.idleScope ?? "-",
      ])}
    />
  );
}

export function RuntimeOutboxTable({
  rows,
}: {
  rows: readonly RuntimeOutboxRow[];
}) {
  if (rows.length === 0)
    return <EmptyRuntimeRows label="No outbox rows found." />;
  return (
    <SimpleTable
      columns={["state", "outbox", "target", "attempts", "next"]}
      rows={rows.map((row) => [
        <Chip
          key="state"
          tone={
            row.state === "confirmed"
              ? "ok"
              : row.state === "pending"
                ? "crux"
                : "warn"
          }
          mono
          dot
        >
          {row.state}
        </Chip>,
        <Mono key="outbox">{row.outboxId}</Mono>,
        <Mono key="target">{row.envelope.target}</Mono>,
        String(row.attempts),
        fmtRuntimeDate(row.nextAttemptAt),
      ])}
    />
  );
}

function SimpleTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly React.ReactNode[])[];
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
        <thead style={{ color: "var(--devtools-fg-faint)" }}>
          <tr
            className="border-b"
            style={{ borderColor: "var(--devtools-border)" }}
          >
            {columns.map((column) => (
              <Th key={column}>{column}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b"
              style={{ borderColor: "var(--devtools-border)" }}
            >
              {row.map((cell, cellIndex) => (
                <Td key={cellIndex}>{cell}</Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]">
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-3 py-2 align-middle">{children}</td>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

function EmptyRuntimeRows({ label }: { label: string }) {
  return (
    <div
      className="px-4 py-8 text-center text-[12px]"
      style={{ color: "var(--devtools-fg-muted)" }}
    >
      {label}
    </div>
  );
}
