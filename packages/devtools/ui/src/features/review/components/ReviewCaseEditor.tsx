import { useEffect, useState } from "react";
import { Btn, Chip } from "@/qw/shell/primitives";
import { useReviewAction } from "../hooks/useReview";
import type { AddReviewCaseResult, ReviewProjection } from "../types";

export function ReviewCaseEditor({
  reviewId,
  projection,
}: {
  reviewId: string;
  projection: ReviewProjection;
}) {
  const action = useReviewAction(reviewId);
  const [evalId, setEvalId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [input, setInput] = useState("{}");
  const [expected, setExpected] = useState("");
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    setInput(JSON.stringify(projection.context?.input ?? {}, null, 2));
    setExpected(
      projection.correction === undefined
        ? ""
        : JSON.stringify(projection.correction, null, 2),
    );
  }, [projection]);

  const submit = () => {
    try {
      const parsedInput = JSON.parse(input) as unknown;
      const parsedExpected =
        expected.trim() === "" ? undefined : (JSON.parse(expected) as unknown);
      setParseError("");
      action.mutate({
        type: "add-to-eval",
        evalId,
        caseId,
        input: parsedInput,
        ...(parsedExpected !== undefined
          ? { correctionProposal: parsedExpected, saveCorrection: true }
          : {}),
      });
    } catch {
      setParseError("Input and expected must contain valid JSON.");
    }
  };
  const result =
    action.data && "row" in action.data
      ? (action.data as AddReviewCaseResult)
      : undefined;

  return (
    <section
      className="space-y-3 border-t pt-4"
      style={{ borderColor: "var(--qw-border)" }}
    >
      <h2 className="text-[12px] font-semibold uppercase tracking-wider">
        Add to Eval
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Eval ID" value={evalId} onChange={setEvalId} />
        <Field label="Case ID" value={caseId} onChange={setCaseId} />
      </div>
      <JsonField label="Input from run" value={input} onChange={setInput} />
      <JsonField
        label="Expected correction (optional; saved only when present)"
        value={expected}
        onChange={setExpected}
      />
      {parseError && (
        <p
          role="alert"
          className="text-[12px]"
          style={{ color: "var(--qw-danger)" }}
        >
          {parseError}
        </p>
      )}
      <Btn
        variant="primary"
        onClick={submit}
        disabled={action.isPending || !evalId || !caseId}
      >
        {action.isPending ? "Saving…" : "Save Case"}
      </Btn>
      {result && <ResultArtifact result={result} />}
    </section>
  );
}

function ResultArtifact({ result }: { result: AddReviewCaseResult }) {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ background: "var(--qw-bg-muted)" }}
    >
      <div className="flex gap-2">
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
      {result.unvalidatedExpected && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--qw-warn)" }}>
          Expected is stored as unvalidated JSON.
        </p>
      )}
    </div>
  );
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
          background: "var(--qw-bg)",
          border: "1px solid var(--qw-border)",
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
          background: "var(--qw-bg)",
          border: "1px solid var(--qw-border)",
        }}
      />
    </label>
  );
}
