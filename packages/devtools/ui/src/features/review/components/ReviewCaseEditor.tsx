import { useEffect, useState } from "react";
import { Btn, Chip } from "@/devtools/shell/primitives";
import { useReviewAction } from "../hooks/useReview";
import type { AddReviewCaseResult, ReviewProjection } from "../types";
import type { EvalCatalogEntry } from "@/features/evals/types";

export function ReviewCaseEditor({
  reviewId,
  projection,
  evals,
}: {
  reviewId: string;
  projection: ReviewProjection;
  evals: readonly EvalCatalogEntry[];
}) {
  const action = useReviewAction(reviewId);
  const [evalId, setEvalId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [input, setInput] = useState("{}");
  const [call, setCall] = useState("");
  const [expected, setExpected] = useState("");
  const [parseError, setParseError] = useState("");
  const [preview, setPreview] = useState<AddReviewCaseResult>();
  const [saved, setSaved] = useState<AddReviewCaseResult>();
  const [previewSignature, setPreviewSignature] = useState("");

  useEffect(() => {
    setInput(JSON.stringify(projection.context?.input ?? {}, null, 2));
    setCall(
      projection.context?.call === undefined
        ? ""
        : JSON.stringify(projection.context.call, null, 2),
    );
    setExpected(
      projection.correction === undefined
        ? ""
        : JSON.stringify(projection.correction, null, 2),
    );
  }, [projection]);

  const signature = JSON.stringify({ evalId, caseId, input, call, expected });
  const request = (type: "preview-add-to-eval" | "add-to-eval") => {
    try {
      const parsedInput = JSON.parse(input) as unknown;
      const parsedExpected =
        expected.trim() === "" ? undefined : (JSON.parse(expected) as unknown);
      const parsedCall =
        call.trim() === "" ? undefined : (JSON.parse(call) as unknown);
      setParseError("");
      return {
        type,
        evalId,
        caseId,
        input: parsedInput,
        ...(parsedCall !== undefined ? { call: parsedCall } : {}),
        ...(parsedExpected !== undefined
          ? { correctionProposal: parsedExpected, saveCorrection: true }
          : {}),
      };
    } catch {
      setParseError("Input and expected must contain valid JSON.");
      return undefined;
    }
  };
  const previewCase = async () => {
    const body = request("preview-add-to-eval");
    if (!body) return;
    const result = await action.mutateAsync(body);
    if ("row" in result) {
      setPreview(result as AddReviewCaseResult);
      setPreviewSignature(signature);
      setSaved(undefined);
    }
  };
  const submit = async () => {
    const body = request("add-to-eval");
    if (!body) return;
    const result = await action.mutateAsync(body);
    if ("row" in result) setSaved(result as AddReviewCaseResult);
  };
  const previewCurrent =
    preview !== undefined && previewSignature === signature;

  return (
    <section
      className="space-y-3 border-t pt-4"
      style={{ borderColor: "var(--devtools-border)" }}
    >
      <h2 className="text-[12px] font-semibold uppercase tracking-wider">
        Add to Eval
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] font-medium">
          <span>Eval</span>
          <select
            value={evalId}
            onChange={(event) => setEvalId(event.target.value)}
            className="w-full rounded-[6px] px-2.5 py-2 font-mono text-[12px]"
            style={{
              background: "var(--devtools-bg)",
              border: "1px solid var(--devtools-border)",
            }}
          >
            <option value="">Select a discovered Eval</option>
            {evals.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <Field label="Case ID" value={caseId} onChange={setCaseId} />
      </div>
      <JsonField label="Input from run" value={input} onChange={setInput} />
      <JsonField
        label="Call overrides (optional)"
        value={call}
        onChange={setCall}
      />
      <JsonField
        label="Expected correction (optional; saved only when present)"
        value={expected}
        onChange={setExpected}
      />
      {parseError && (
        <p
          role="alert"
          className="text-[12px]"
          style={{ color: "var(--devtools-danger)" }}
        >
          {parseError}
        </p>
      )}
      <div className="flex gap-2">
        <Btn
          onClick={() => void previewCase().catch(() => undefined)}
          disabled={action.isPending || !evalId || !caseId}
        >
          {action.isPending ? "Working…" : "Preview Case"}
        </Btn>
        <Btn
          variant="primary"
          onClick={() => void submit().catch(() => undefined)}
          disabled={action.isPending || !previewCurrent}
        >
          Save Case
        </Btn>
      </div>
      {action.isError ? (
        <p
          role="alert"
          className="text-[12px]"
          style={{ color: "var(--devtools-danger)" }}
        >
          {action.error.message}
        </p>
      ) : null}
      {saved ? (
        <ResultArtifact result={saved} />
      ) : previewCurrent && preview ? (
        <ResultArtifact result={preview} preview />
      ) : null}
    </section>
  );
}

function ResultArtifact({
  result,
  preview = false,
}: {
  result: AddReviewCaseResult;
  preview?: boolean;
}) {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ background: "var(--devtools-bg-muted)" }}
    >
      <div className="flex gap-2">
        {preview ? <Chip tone="muted">proposed</Chip> : null}
        <Chip
          tone={
            result.status === "conflict"
              ? "danger"
              : result.status === "pending-sync"
                ? "warn"
                : "ok"
          }
        >
          {result.status}
        </Chip>
        <span className="font-mono text-[11px]">{result.path}</span>
      </div>
      <pre className="mt-3 overflow-auto text-[10.5px] leading-5">
        {result.row}
      </pre>
      <details className="mt-2" open={preview}>
        <summary className="cursor-pointer text-[11px] font-semibold">
          Sidecar diff
        </summary>
        <pre className="mt-2 overflow-auto text-[10.5px] leading-5">
          {result.diff}
        </pre>
      </details>
      {result.existing ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold">
            Existing conflicting Case
          </summary>
          <pre className="mt-2 overflow-auto text-[10.5px] leading-5">
            {result.existing}
          </pre>
        </details>
      ) : null}
      {result.status === "pending-sync" ? (
        <button
          type="button"
          className="mt-2 cursor-pointer text-[11px] font-semibold underline"
          onClick={() => downloadRow(result)}
        >
          Download Case row
        </button>
      ) : null}
      {result.unvalidatedExpected && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          Expected is stored as unvalidated JSON.
        </p>
      )}
    </div>
  );
}

function downloadRow(result: AddReviewCaseResult): void {
  const url = URL.createObjectURL(
    new Blob([result.row], { type: "application/x-ndjson" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${result.caseId}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-[11px] font-medium">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[6px] px-2.5 py-2 font-mono text-[12px]"
        style={{
          background: "var(--devtools-bg)",
          border: "1px solid var(--devtools-border)",
        }}
      />
    </label>
  );
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-[11px] font-medium">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="w-full resize-y rounded-[6px] px-2.5 py-2 font-mono text-[11px] leading-5"
        style={{
          background: "var(--devtools-bg)",
          border: "1px solid var(--devtools-border)",
        }}
      />
    </label>
  );
}
