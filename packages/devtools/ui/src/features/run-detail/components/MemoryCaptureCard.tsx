import { useNavigation } from "@/app/navigation/useNavigation";
import { Chip } from "@/devtools/shell/primitives";
import { useProjectDefinitionIds } from "@/shared/query/useProjectDefinitionIds";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  memoryCaptureFromNode,
  type MemoryCaptureDisposition,
  type MemoryCaptureOutcome,
  type MemoryCaptureView,
} from "../lib/memory-capture";
import { CardShell, KeyValue } from "./SpanDetailPanelAtoms";

interface MemoryCaptureCardProps {
  readonly view: MemoryCaptureView;
  readonly onOpenCatalog?: (definitionId: string) => void;
}

function dispositionTone(
  disposition: MemoryCaptureDisposition,
): "crux" | "muted" | "warn" {
  switch (disposition) {
    case "inline":
      return "crux";
    case "inline-fallback":
      return "warn";
    case "retained":
    case "eval-captured":
      return "muted";
  }
}

function outcomeTone(
  outcome: MemoryCaptureOutcome,
): "ok" | "danger" | "muted" {
  switch (outcome) {
    case "completed":
      return "ok";
    case "failed":
      return "danger";
    case "captured":
      return "muted";
  }
}

function dispositionExplanation(
  disposition: MemoryCaptureDisposition,
): string | undefined {
  switch (disposition) {
    case "inline":
      return undefined;
    case "inline-fallback":
      return "No retained host accepted this work; capture ran inline.";
    case "retained":
      return "The owning host retained work beyond the response boundary.";
    case "eval-captured":
      return "Eval recorded deferred intent; memory hooks did not run.";
  }
}

function CatalogMemory({
  view,
  onOpenCatalog,
}: MemoryCaptureCardProps) {
  const reference = view.memory;
  if (!reference) return <span>{view.memoryId}</span>;
  if (!reference.resolved || !onOpenCatalog) {
    return <span className="font-mono">{reference.value}</span>;
  }
  return (
    <button
      type="button"
      className="font-mono underline underline-offset-2"
      aria-label={`Open ${reference.value} in Catalog`}
      onClick={() => onOpenCatalog(reference.value)}
    >
      {reference.value}
    </button>
  );
}

/** Render one validated, payload-free `memory.capture` lifecycle summary. */
export function MemoryCaptureCard({
  view,
  onOpenCatalog,
}: MemoryCaptureCardProps) {
  const explanation = dispositionExplanation(view.disposition);
  const failed = view.outcome === "failed" || view.status === "error";

  return (
    <section aria-label="Memory capture" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="crux">requested {view.requestedMode}</Chip>
        <Chip tone={dispositionTone(view.disposition)}>
          {view.disposition}
        </Chip>
        {view.outcome && (
          <Chip tone={outcomeTone(view.outcome)} dot>
            {view.outcome}
          </Chip>
        )}
      </div>

      {explanation && (
        <div
          className="rounded-md border px-3 py-2 text-[12px] leading-relaxed"
          style={{
            borderColor:
              view.disposition === "inline-fallback"
                ? "var(--devtools-warn)"
                : "var(--devtools-border)",
            background:
              view.disposition === "inline-fallback"
                ? "var(--devtools-warn-soft)"
                : "var(--devtools-bg-muted)",
            color:
              view.disposition === "inline-fallback"
                ? "var(--devtools-warn)"
                : "var(--devtools-fg-muted)",
          }}
        >
          {explanation}
        </div>
      )}

      {failed && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "var(--devtools-danger)",
            background: "var(--devtools-danger-soft)",
            color: "var(--devtools-danger)",
          }}
        >
          Memory capture failed{view.code ? ` · ${view.code}` : ""}
        </div>
      )}

      <CardShell label="Capture details">
        <div className="grid gap-2 px-3.5 py-3">
          <KeyValue
            k="Memory / Catalog"
            v={<CatalogMemory view={view} onOpenCatalog={onOpenCatalog} />}
          />
          <KeyValue k="Operation" v={view.operation} />
          <KeyValue k="Sequence" v={String(view.sequence)} />
          <KeyValue k="Blocks" v={String(view.blockCount)} />
          <KeyValue k="Tool events" v={String(view.toolEventCount)} />
          <KeyValue k="Duration" v={`${view.durationMs.toLocaleString()}ms`} />
        </div>
      </CardShell>
    </section>
  );
}

/** Connected card for the selected canonical Run Detail node. */
export function MemoryCaptureNode({
  node,
}: {
  readonly node: ObservabilityRunDetailNode;
}) {
  const knownDefinitionIds = useProjectDefinitionIds();
  const { navigate } = useNavigation();
  const view = memoryCaptureFromNode(node, knownDefinitionIds);

  if (!view) {
    return (
      <div
        className="text-[12px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Memory capture details unavailable.
      </div>
    );
  }

  return (
    <MemoryCaptureCard
      view={view}
      onOpenCatalog={(definitionId) =>
        navigate({ view: "library-index", promptId: definitionId })
      }
    />
  );
}
