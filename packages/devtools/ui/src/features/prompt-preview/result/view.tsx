import type { ReactNode } from "react";

import type { PromptPreviewWorkflowState } from "../types";
import {
  contributionBoundaryDescription,
  promptPreviewIssuePath,
  promptPreviewStatusLabel,
} from "./model";

function Panel({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded border p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function ReadyResult({
  result,
}: {
  readonly result: Extract<
    NonNullable<PromptPreviewWorkflowState["result"]>,
    { readonly status: "ready" }
  >;
}) {
  const { preview, contributions } = result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <strong>{promptPreviewStatusLabel(preview.status)}</strong>
        {preview.model && (
          <span className="break-all">model · {preview.model}</span>
        )}
        {preview.inputTokens !== undefined && (
          <span>input · {preview.inputTokens}</span>
        )}
        {preview.maxInputTokens !== undefined && (
          <span>limit · {preview.maxInputTokens}</span>
        )}
        <span>measurement · {preview.measurement}</span>
      </div>
      <Panel title="Contribution map">
        {contributions.length === 0 ? (
          <p className="text-xs opacity-70">No model-facing contributions.</p>
        ) : (
          <ul className="space-y-2">
            {contributions.map((contribution) => (
              <li key={contribution.id} className="rounded border p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <strong className="break-all">{contribution.id}</strong>
                  <span data-contribution-boundary={contribution.boundary}>
                    {contribution.boundary}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-70">
                  {contributionBoundaryDescription(contribution.boundary)}
                </p>
                <div className="mt-1 font-mono text-[10px] opacity-70">
                  {contribution.representations.join(" → ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Prospective adaptations">
        {preview.adaptations.length === 0 ? (
          <p className="text-xs opacity-70">None.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {preview.adaptations.map((adaptation, index) => (
              <li key={`${adaptation.contributor}:${index}`}>
                <strong>{adaptation.contributor}</strong> ·{" "}
                {adaptation.representation} · {adaptation.state}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {(preview.warnings.length > 0 || preview.diagnostics.length > 0) && (
        <Panel title="Planning notices">
          <ul className="space-y-1 text-xs">
            {preview.warnings.map((warning, index) => (
              <li key={`warning:${warning.code}:${index}`}>
                {warning.code} · {warning.message}
              </li>
            ))}
            {preview.diagnostics.map((diagnostic, index) => (
              <li key={`diagnostic:${diagnostic.id}:${index}`}>
                {diagnostic.code} · {diagnostic.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** Presents observational request planning and contribution boundaries. */
export function PromptPreviewResultView({
  state,
}: {
  readonly state: PromptPreviewWorkflowState;
}) {
  if (state.phase === "running") {
    return (
      <section role="status" aria-live="polite">
        Running request preview…
      </section>
    );
  }
  if (state.phase === "error") {
    return (
      <section role="alert">
        {state.message ?? "Request preview failed."}
      </section>
    );
  }
  if (!state.result) return <section>No preview result yet.</section>;

  const result = state.result;
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-medium">
        {result.status === "ready" ? "Request preview" : "Validation"}
      </h2>
      {result.status === "ready" ? (
        <ReadyResult result={result} />
      ) : result.status === "validation-error" ? (
        <div className="space-y-2">
          {result.issues.map((issue, index) => (
            <div key={`${issue.code}:${index}`} className="rounded border p-3">
              <div className="font-mono text-xs font-semibold">
                {issue.code} · {promptPreviewIssuePath(issue.path)}
              </div>
              <p className="mt-1 text-sm">{issue.message}</p>
            </div>
          ))}
          {result.issues.length === 0 && (
            <p className="text-sm">
              Validation failed without retained issues.
            </p>
          )}
          {result.omittedIssueCount > 0 && (
            <p className="text-xs opacity-70">
              {result.omittedIssueCount} additional issues omitted.
            </p>
          )}
        </div>
      ) : (
        <p role="alert">{result.message}</p>
      )}
      <details>
        <summary className="cursor-pointer text-xs">Raw result JSON</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}
