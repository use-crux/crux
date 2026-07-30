import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useNavigation } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { PromptPreviewForm } from "./input/PromptPreviewForm";
import { parsePromptPreviewRaw } from "./input/raw";
import { promptPreviewFormSchema } from "./input/schema";
import { PromptPreviewResultView } from "./result/view";
import type { PromptPreviewChoice, PromptPreviewWorkflowState } from "./types";
import {
  createPromptPreviewWorkflow,
  type PromptPreviewWorkflow,
} from "./workflow";

const confirmation =
  "Preview runs canonical inspection in the selected application runtime. Trusted refinements, transforms, prompt and context callbacks, retrieval, memory, and memo callbacks may perform side effects or I/O. It does not invoke a model provider or tool and creates no ordinary Run.";

export function PromptPreviewView({
  definitionId,
}: {
  readonly definitionId: string;
}) {
  const workflow = useMemo(
    () => createPromptPreviewWorkflow(definitionId),
    [definitionId],
  );
  const state = useSyncExternalStore(
    workflow.subscribe,
    workflow.snapshot,
    workflow.snapshot,
  );
  const { navigate } = useNavigation();

  useEffect(() => {
    void workflow.refresh();
    const refresh = (): void => {
      if (document.visibilityState === "visible") void workflow.refresh();
    };
    const interval = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("crux:prompt-preview-changed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("crux:prompt-preview-changed", refresh);
      workflow.dispose();
    };
  }, [workflow]);

  return (
    <DevtoolsShell
      breadcrumb="Library / Index / Prompt preview"
      title="Exact Prompt preview"
      subtitle={definitionId}
      actions={
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-xs"
          onClick={() => navigate({ view: "library-index" })}
        >
          Return to Catalog
        </button>
      }
    >
      <PromptPreviewContent
        state={state}
        onRawText={workflow.setRawText}
        onFormValue={workflow.setFormValue}
        onSelect={workflow.select}
        onPreview={() => void workflow.preview()}
        onCancel={workflow.cancel}
      />
    </DevtoolsShell>
  );
}

export function PromptPreviewContent({
  state,
  onRawText,
  onFormValue,
  onSelect,
  onPreview,
  onCancel,
}: {
  readonly state: PromptPreviewWorkflowState;
  readonly onRawText: (text: string) => void;
  readonly onFormValue: (value: Readonly<Record<string, unknown>>) => void;
  readonly onSelect: (choice: PromptPreviewChoice | undefined) => void;
  readonly onPreview: () => void;
  readonly onCancel: () => void;
}) {
  const [tab, setTab] = useState<"raw" | "form">("raw");
  const running = state.phase === "running";
  const discovery =
    state.discovery?.status === "ready" ? state.discovery : undefined;
  const schema =
    state.selected?.target.input.mode === "schema"
      ? promptPreviewFormSchema(state.selected.target.input.schema)
      : undefined;
  const parsed = parsePromptPreviewRaw(state.rawText);

  if (state.phase === "unavailable") {
    const message =
      state.discovery?.status === "unavailable" &&
      state.discovery.reason === "owner-not-found"
        ? "This Prompt is no longer present in the current Project Index. Return to Catalog."
        : state.message;
    return (
      <div className="p-8">
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-8 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      <section className="space-y-5">
        <div className="space-y-2">
          <label
            className="text-xs font-medium"
            htmlFor="prompt-preview-runtime"
          >
            Application runtime
          </label>
          <select
            id="prompt-preview-runtime"
            disabled={running || !discovery}
            value={state.selected ? choiceKey(state.selected) : ""}
            onChange={(event) =>
              onSelect(
                discovery?.choices.find(
                  (choice) => choiceKey(choice) === event.target.value,
                ),
              )
            }
            className="w-full rounded border bg-transparent p-2 text-sm"
          >
            <option value="">Select a runtime</option>
            {discovery?.choices.map((choice) => (
              <option key={choiceKey(choice)} value={choiceKey(choice)}>
                {choice.runtimeName} · {choice.environment} · {choice.peerId} ·
                catalogue {choice.catalogueRevision}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("raw")}
            aria-pressed={tab === "raw"}
          >
            Raw JSON
          </button>
          {schema && parsed && (
            <button
              type="button"
              onClick={() => setTab("form")}
              aria-pressed={tab === "form"}
            >
              Form
            </button>
          )}
        </div>

        {tab === "form" && schema && parsed ? (
          <PromptPreviewForm
            schema={schema}
            value={parsed}
            disabled={running}
            onChange={onFormValue}
          />
        ) : (
          <textarea
            aria-label="Exact preview input JSON"
            value={state.rawText}
            disabled={running}
            rows={16}
            spellCheck={false}
            onChange={(event) => onRawText(event.target.value)}
            className="w-full rounded border bg-transparent p-3 font-mono text-xs"
          />
        )}
        {!parsed && (
          <p role="alert" className="text-xs text-red-500">
            Enter one valid JSON object within the exact-preview limits.
          </p>
        )}
        <p className="text-xs leading-5 opacity-75">{confirmation}</p>
        <div className="flex gap-2">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border px-3 py-2"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={!state.canPreview}
              onClick={onPreview}
              className="rounded border px-3 py-2"
            >
              {state.result ? "Retry" : "Preview"}
            </button>
          )}
        </div>
      </section>
      <PromptPreviewResultView state={state} />
    </div>
  );
}

function choiceKey(choice: PromptPreviewChoice): string {
  return JSON.stringify([
    choice.peerId,
    choice.environment,
    choice.catalogueRevision,
  ]);
}
