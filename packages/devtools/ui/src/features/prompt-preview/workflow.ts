import {
  canonicalPrettyPromptPreviewJson,
  parsePromptPreviewRaw,
} from "./input/raw";
import { shouldRefreshPromptPreviewDiscovery } from "./refresh-policy";
import { discoverPromptPreview, dispatchPromptPreview } from "./service";
import type { PromptPreviewChoice, PromptPreviewWorkflowState } from "./types";
import {
  matchingPromptPreviewChoice,
  promptPreviewInputState,
} from "./workflow-state";

export interface PromptPreviewWorkflow {
  readonly snapshot: () => PromptPreviewWorkflowState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: (signal?: AbortSignal) => Promise<void>;
  readonly setRawText: (text: string) => void;
  readonly setFormValue: (value: Readonly<Record<string, unknown>>) => void;
  readonly select: (choice: PromptPreviewChoice | undefined) => void;
  readonly preview: (signal?: AbortSignal) => Promise<void>;
  readonly cancel: () => void;
  readonly dispose: () => void;
}

/**
 * Create one ephemeral exact-preview session.
 *
 * Discovery and edits never execute application code. Only {@link preview}
 * crosses the explicit confirmation boundary.
 */
export function createPromptPreviewWorkflow(
  definitionId: string,
): PromptPreviewWorkflow {
  let input: Readonly<Record<string, unknown>> | undefined = {};
  let state: PromptPreviewWorkflowState = {
    phase: "idle",
    rawText: "{}",
    canPreview: false,
  };
  let refreshInFlight: Promise<void> | undefined;
  let refreshController: AbortController | undefined;
  let dispatchController: AbortController | undefined;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (next: PromptPreviewWorkflowState): void => {
    if (disposed) return;
    state = next;
    listeners.forEach((listener) => listener());
  };

  const refresh = (signal?: AbortSignal): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (refreshInFlight) return refreshInFlight;
    const startedGeneration = generation;
    const controller = new AbortController();
    refreshController = controller;
    const abort = (): void => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const pending = discoverPromptPreview(definitionId, controller.signal)
      .then((discovery) => {
        if (
          disposed ||
          controller.signal.aborted ||
          startedGeneration !== generation
        ) {
          return;
        }
        if (discovery.status === "unavailable") {
          if (state.phase === "running") retireDispatch();
          publish({
            phase: "unavailable",
            rawText: state.rawText,
            canPreview: false,
            message: discovery.message,
            discovery,
          });
          return;
        }
        const retained = matchingPromptPreviewChoice(discovery, state.selected);
        if (state.phase === "running") {
          if (!retained) {
            retireDispatch();
            publish(
              promptPreviewInputState(
                definitionId,
                state.rawText,
                input,
                discovery,
                undefined,
              ),
            );
            return;
          }
          publish({ ...state, discovery, selected: retained });
          return;
        }
        const selected =
          retained ??
          (discovery.choices.length === 1 ? discovery.choices[0] : undefined);
        const tupleChanged =
          state.selected !== undefined && retained === undefined;
        publish(
          promptPreviewInputState(
            definitionId,
            state.rawText,
            input,
            discovery,
            selected,
            tupleChanged ? undefined : state.result,
          ),
        );
      })
      .catch((error: unknown) => {
        if (
          disposed ||
          controller.signal.aborted ||
          startedGeneration !== generation
        ) {
          return;
        }
        publish({
          phase: "error",
          rawText: state.rawText,
          canPreview: false,
          message:
            error instanceof Error
              ? error.message
              : "Prompt preview discovery failed.",
        });
      })
      .finally(() => {
        signal?.removeEventListener("abort", abort);
        if (refreshController === controller) refreshController = undefined;
        if (refreshInFlight === pending) refreshInFlight = undefined;
      });
    refreshInFlight = pending;
    return pending;
  };

  const setRawText = (text: string): void => {
    if (state.phase === "running") return;
    input = parsePromptPreviewRaw(text);
    publish(
      state.discovery?.status === "ready"
        ? promptPreviewInputState(
            definitionId,
            text,
            input,
            state.discovery,
            state.selected,
          )
        : { ...state, rawText: text, canPreview: false, result: undefined },
    );
  };

  const setFormValue = (value: Readonly<Record<string, unknown>>): void => {
    setRawText(canonicalPrettyPromptPreviewJson(value));
  };

  const select = (choice: PromptPreviewChoice | undefined): void => {
    if (state.phase === "running" || state.discovery?.status !== "ready")
      return;
    const selected = matchingPromptPreviewChoice(state.discovery, choice);
    publish(
      promptPreviewInputState(
        definitionId,
        state.rawText,
        input,
        state.discovery,
        selected,
        undefined,
      ),
    );
  };

  const preview = async (signal?: AbortSignal): Promise<void> => {
    if (!state.selected || !input || !state.canPreview || disposed) return;
    retireRefresh();
    const selected = state.selected;
    const discovery = state.discovery;
    const rawText = state.rawText;
    const requestGeneration = ++generation;
    const controller = new AbortController();
    dispatchController = controller;
    const abort = (): void => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    publish({
      ...state,
      phase: "running",
      canPreview: false,
      result: undefined,
    });
    try {
      const result = await dispatchPromptPreview(
        definitionId,
        selected,
        input,
        controller.signal,
      );
      if (disposed || generation !== requestGeneration) return;
      publish({
        phase: result.status,
        rawText,
        canPreview: true,
        discovery,
        selected,
        result,
        ...(result.status === "error" ? { message: result.message } : {}),
      });
      if (
        result.status === "error" &&
        shouldRefreshPromptPreviewDiscovery(result.code)
      ) {
        retireRefresh();
        await refresh();
      }
    } catch (error) {
      if (
        disposed ||
        generation !== requestGeneration ||
        controller.signal.aborted
      ) {
        return;
      }
      publish({
        phase: "error",
        rawText,
        canPreview: true,
        discovery,
        selected,
        message:
          error instanceof Error ? error.message : "Exact preview failed.",
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      if (dispatchController === controller) dispatchController = undefined;
    }
  };

  const retireDispatch = (): void => {
    if (!dispatchController) return;
    generation += 1;
    dispatchController.abort();
    dispatchController = undefined;
  };

  const retireRefresh = (): void => {
    refreshController?.abort();
    refreshController = undefined;
    refreshInFlight = undefined;
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    setRawText,
    setFormValue,
    select,
    preview,
    cancel: () => {
      if (!dispatchController) return;
      retireDispatch();
      if (state.discovery?.status === "ready") {
        publish(
          promptPreviewInputState(
            definitionId,
            state.rawText,
            input,
            state.discovery,
            state.selected,
          ),
        );
      }
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      retireRefresh();
      dispatchController?.abort();
      dispatchController = undefined;
      listeners.clear();
    },
  };
}
