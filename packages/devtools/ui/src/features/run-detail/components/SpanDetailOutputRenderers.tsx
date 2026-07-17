import { Streamdown } from "streamdown";
import { JsonTree } from "@/shared/components/JsonTree";
import { TokenizedText } from "./StreamingChunks";
import { PendingFromBackend } from "./SpanDetailPanelAtoms";
import type { OutputRenderMode } from "../lib/span-detail-inspection";

export function OutputModeToggle({
  mode,
  onModeChange,
}: {
  mode: OutputRenderMode;
  onModeChange: (mode: OutputRenderMode) => void;
}) {
  return (
    <span
      className="inline-flex overflow-hidden rounded-[6px] font-mono text-[10.5px]"
      style={{
        border: "1px solid var(--qw-border)",
        background: "var(--qw-bg)",
      }}
    >
      {(["raw", "pretty"] as const).map((id) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onModeChange(id)}
            className="px-2 py-1"
            style={{
              color: active ? "var(--qw-crux)" : "var(--qw-fg-muted)",
              background: active ? "var(--qw-crux-soft)" : "transparent",
            }}
          >
            {id}
          </button>
        );
      })}
    </span>
  );
}

export function OutputTextView({
  text,
  mode,
}: {
  text: string;
  mode: OutputRenderMode;
}) {
  if (mode === "pretty") {
    return (
      <div className="qw-prose">
        <Streamdown>{text}</Streamdown>
      </div>
    );
  }
  return (
    <pre
      className="m-0 whitespace-pre-wrap break-words rounded-[6px] px-3 py-2 font-mono text-[12px] leading-[1.65]"
      style={{
        background: "var(--qw-bg)",
        border: "1px solid var(--qw-border)",
        color: "var(--qw-fg)",
      }}
    >
      <TokenizedText text={text} showTokenIndex />
    </pre>
  );
}

export function ExpectedVsActualFrame({
  actual,
  obj,
}: {
  actual: string | undefined;
  obj: unknown;
}) {
  const actualBody = actual ? (
    <OutputTextView text={actual} mode="raw" />
  ) : obj ? (
    <div>
      <JsonTree data={obj as unknown} />
    </div>
  ) : (
    <span style={{ color: "var(--qw-fg-faint)" }}>(no output)</span>
  );
  return (
    <div
      className="grid overflow-hidden rounded-[10px]"
      style={{
        gridTemplateColumns: "1fr 1fr",
        border: "1px solid var(--qw-border)",
      }}
    >
      <div style={{ borderRight: "1px solid var(--qw-border)" }}>
        <div
          className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]"
          style={{
            background: "var(--qw-bg-muted)",
            color: "var(--qw-fg-faint)",
            borderBottom: "1px solid var(--qw-border)",
          }}
        >
          Expected
        </div>
        <div className="px-3.5 py-3">
          <PendingFromBackend what="Expected output diff" />
        </div>
      </div>
      <div>
        <div
          className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]"
          style={{
            background: "var(--qw-bg-muted)",
            color: "var(--qw-fg-faint)",
            borderBottom: "1px solid var(--qw-border)",
          }}
        >
          Actual
        </div>
        <div
          className="px-3.5 py-3 text-[13.5px] leading-[1.65]"
          style={{ fontFamily: "var(--qw-serif)", color: "var(--qw-fg)" }}
        >
          {actualBody}
        </div>
      </div>
    </div>
  );
}
