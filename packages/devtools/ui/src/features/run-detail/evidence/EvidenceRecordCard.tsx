/** One canonical execution-evidence relationship card. */

import { useEffect, useRef } from "react";
import { Chip } from "@/devtools/shell/primitives";
import { JsonTree } from "@/shared/components/JsonTree";
import type { projectEvidenceRecord } from "./presentation";
import type { EvidenceApiSubject } from "./types";

export interface EvidenceRecordCardProps {
  readonly record: ReturnType<typeof projectEvidenceRecord>;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onNavigateRef: (ref: EvidenceApiSubject) => void;
  readonly canNavigateRef: (ref: EvidenceApiSubject) => boolean;
}

/** Render one relationship without duplicating domain-native artifact cards. */
export function EvidenceRecordCard({
  record,
  selected,
  onSelect,
  onNavigateRef,
  canNavigateRef,
}: EvidenceRecordCardProps) {
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <article
      ref={rootRef}
      id={`evidence-${record.id}`}
      data-evidence-id={record.id}
      className="rounded-[9px] border bg-(--devtools-bg-elev) p-3"
      style={{
        borderColor: selected
          ? "var(--devtools-crux)"
          : "var(--devtools-border)",
      }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="w-full text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-(--devtools-fg)">
            {record.renderer.label}
          </span>
          <Chip tone="muted" mono>
            {record.evidenceKind}
          </Chip>
          {record.conclusion ? (
            <Chip tone="crux">{record.conclusion}</Chip>
          ) : null}
        </div>
      </button>
      <div className="mt-2 text-[10.5px] text-(--devtools-fg-muted)">
        {record.payload.label}
      </div>
      {record.payload.data !== undefined ? (
        <div className="mt-2 max-h-48 overflow-auto rounded-[6px] bg-(--devtools-bg-muted) p-2 text-(--devtools-fg-muted)">
          <JsonTree data={record.payload.data} />
        </div>
      ) : null}
      {record.acceptedAfterTerminal ? (
        <p
          title={record.acceptedAfterTerminal.tooltip}
          className="mt-2 text-[10.5px] text-(--devtools-fg-muted)"
        >
          {record.acceptedAfterTerminal.label}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {record.producer && canNavigateRef(record.producer) ? (
          <RefButton
            label={`Open producer ${record.producer.kind}`}
            onClick={() => onNavigateRef(record.producer!)}
          />
        ) : null}
        {canNavigateRef(record.source) ? (
          <RefButton
            label={`Open source ${record.source.kind}`}
            onClick={() => onNavigateRef(record.source)}
          />
        ) : null}
      </div>
      {record.producer && !canNavigateRef(record.producer) ? (
        <p className="mt-2 text-[10px] text-(--devtools-fg-faint)">
          Producer navigation is unavailable because the retained execution
          cannot be resolved in this run.
        </p>
      ) : null}
      {!canNavigateRef(record.source) ? (
        <p className="mt-2 text-[10px] text-(--devtools-fg-faint)">
          Source navigation is unavailable because its retained owner cannot be
          resolved in this run.
        </p>
      ) : null}
      {record.unavailableNavigation.map((message) => (
        <p
          key={message}
          className="mt-2 text-[10px] text-(--devtools-fg-faint)"
        >
          {message}
        </p>
      ))}
    </article>
  );
}

function RefButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[5px] border border-(--devtools-border) bg-(--devtools-bg) px-2 py-1 text-[10px] text-(--devtools-crux)"
    >
      {label}
    </button>
  );
}
