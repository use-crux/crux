import type { ReactNode } from "react";

import type { PromptPreviewText, PromptPreviewWorkflowState } from "../types";
import { promptPreviewIssuePath, promptPreviewTextSlices } from "./model";

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

function ProvenanceText({ value }: { readonly value: PromptPreviewText }) {
  return (
    <>
      <div
        className="whitespace-pre-wrap font-mono text-xs leading-5"
        aria-label="Provenance text"
      >
        {promptPreviewTextSlices(value).map((slice) => (
          <span
            key={`${slice.startUtf16}:${slice.endUtf16}`}
            data-prompt-text-kind={slice.kind}
            title={[slice.kind, slice.source, slice.sourceVersion]
              .filter(Boolean)
              .join(" · ")}
            style={{
              background:
                slice.kind === "dynamic"
                  ? "var(--devtools-iris-soft)"
                  : "transparent",
              borderBottom:
                slice.kind === "unknown"
                  ? "1px dotted var(--devtools-fg-muted)"
                  : slice.kind === "dynamic"
                    ? "1px solid var(--devtools-iris)"
                    : "1px solid transparent",
            }}
          >
            {slice.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 font-mono text-[10px] opacity-70">
        {value.staticTokens !== undefined && (
          <span>authored · {value.staticTokens}</span>
        )}
        {value.dynamicTokens !== undefined && (
          <span>interpolated · {value.dynamicTokens}</span>
        )}
        <span>tokens · {value.tokens}</span>
      </div>
    </>
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
  const { inspection } = result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span>total · {inspection.totalTokens}</span>
        {inspection.tokenBudget !== undefined && (
          <span>budget · {inspection.tokenBudget}</span>
        )}
        <span>system · {inspection.system.tokens}</span>
      </div>
      <Panel title="Assembled system">
        <div className="space-y-3">
          {inspection.system.parts.map((part, index) => (
            <div
              key={`${part.source}:${index}`}
              className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
            >
              <div className="flex gap-2 text-xs">
                <strong>{part.source}</strong>
                {part.skipped && <span>skipped</span>}
              </div>
              <ProvenanceText value={part} />
            </div>
          ))}
          {inspection.system.parts.length === 0 && (
            <p className="text-xs opacity-70">No system parts.</p>
          )}
        </div>
      </Panel>
      {inspection.prompt && (
        <Panel title="User prompt">
          <ProvenanceText value={inspection.prompt} />
        </Panel>
      )}
      <Panel title="Dropped contexts">
        {inspection.droppedContexts.length === 0 ? (
          <p className="text-xs opacity-70">None.</p>
        ) : (
          <div className="space-y-3">
            {inspection.droppedContexts.map((context, index) => (
              <div key={`${context.source}:${index}`}>
                <strong className="text-xs">{context.source}</strong>
                <span className="ml-2 text-xs opacity-70">
                  priority · {context.priority}
                </span>
                <ProvenanceText value={context} />
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Excluded contexts">
        {inspection.excludedContexts.length === 0 ? (
          <p className="text-xs opacity-70">None.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {inspection.excludedContexts.map((context, index) => (
              <li key={`${context.source}:${index}`}>
                <strong>{context.source}</strong> · {context.reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * Presents exact-preview inspection and validation as domain structure.
 * Raw JSON remains available only as a secondary diagnostic disclosure.
 */
export function PromptPreviewResultView({
  state,
}: {
  readonly state: PromptPreviewWorkflowState;
}) {
  if (state.phase === "running")
    return <section>Running exact preview…</section>;
  if (state.phase === "error")
    return (
      <section role="alert">{state.message ?? "Exact preview failed."}</section>
    );
  if (!state.result) return <section>No preview result yet.</section>;

  const result = state.result;
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-medium">
        {result.status === "ready" ? "Inspection" : "Validation"}
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
