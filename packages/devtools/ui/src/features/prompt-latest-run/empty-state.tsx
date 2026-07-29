import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigation } from "@/app/navigation/useNavigation";
import { useConnected } from "@/app/runtime/runtimeStore";

import { createPromptLatestRunRefresh } from "./refresh";
import type { PromptLatestRunResponse } from "./types";

interface EmptyStateSnapshot {
  readonly hasRun: boolean;
  readonly exactPreviewAvailable: boolean;
  readonly message?: string;
}

/**
 * Own the Catalog Runs empty-state lifecycle for one current Prompt owner.
 *
 * Background invalidations update presentation booleans only. They never
 * navigate, retain an operation ID, or dispatch preview. Opening a Run always
 * performs a fresh click-time pull.
 */
export function PromptLatestRunEmptyStateController({
  definitionId,
}: {
  readonly definitionId: string;
}) {
  const { navigate } = useNavigation();
  const connected = useConnected();
  const refresh = useMemo(
    () => createPromptLatestRunRefresh(definitionId),
    [definitionId],
  );
  const [snapshot, setSnapshot] = useState<EmptyStateSnapshot>({
    hasRun: false,
    exactPreviewAvailable: false,
  });

  const apply = useCallback((response: PromptLatestRunResponse | undefined) => {
    if (!response) return;
    switch (response.status) {
      case "found":
        setSnapshot((current) => ({
          hasRun: true,
          exactPreviewAvailable: current.exactPreviewAvailable,
        }));
        return;
      case "empty":
        setSnapshot({
          hasRun: false,
          exactPreviewAvailable: response.exactPreview.status === "available",
        });
        return;
      case "unavailable":
      case "error":
        setSnapshot({
          hasRun: false,
          exactPreviewAvailable: false,
          message: response.message,
        });
    }
  }, []);

  const background = useCallback(() => {
    void refresh
      .background()
      .then(apply)
      .catch(() =>
        apply({
          status: "error",
          code: "temporarily_unavailable",
          message: "Latest Run is temporarily unavailable. Retry.",
        }),
      );
  }, [apply, refresh]);

  useEffect(() => {
    background();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") background();
    };
    window.addEventListener("focus", background);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("crux:observability-event", background);
    window.addEventListener("crux:project-index-changed", background);
    window.addEventListener("crux:prompt-preview-changed", background);
    return () => {
      window.removeEventListener("focus", background);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("crux:observability-event", background);
      window.removeEventListener("crux:project-index-changed", background);
      window.removeEventListener("crux:prompt-preview-changed", background);
      refresh.dispose();
    };
  }, [background, refresh]);

  useEffect(() => {
    if (connected) background();
  }, [background, connected]);

  const openLatest = useCallback(() => {
    void refresh
      .fresh()
      .then((response) => {
        if (!response) return;
        if (response.status === "found") {
          navigate({ view: "run-detail", traceId: response.operationId });
          return;
        }
        apply(response);
      })
      .catch(() =>
        apply({
          status: "error",
          code: "temporarily_unavailable",
          message: "Latest Run is temporarily unavailable. Retry.",
        }),
      );
  }, [apply, navigate, refresh]);

  return (
    <>
      {snapshot.message && (
        <p role="alert" className="px-8 pt-6 text-center text-sm">
          {snapshot.message}
        </p>
      )}
      <PromptLatestRunEmptyState
        hasRun={snapshot.hasRun}
        exactPreviewAvailable={snapshot.exactPreviewAvailable}
        onOpenLatest={openLatest}
        onPreviewExact={() =>
          navigate({ view: "prompt-preview", definitionId })
        }
      />
    </>
  );
}

/**
 * Render the Catalog Runs empty state from already validated, presentation-only
 * booleans. Rendering performs no network request or exact-preview dispatch.
 */
export function PromptLatestRunEmptyState({
  hasRun,
  exactPreviewAvailable,
  onOpenLatest,
  onPreviewExact,
}: {
  readonly hasRun: boolean;
  readonly exactPreviewAvailable: boolean;
  readonly onOpenLatest: () => void;
  readonly onPreviewExact: () => void;
}) {
  return (
    <section className="flex min-h-[360px] items-center justify-center p-8">
      <div className="max-w-lg space-y-4 text-center">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {hasRun ? "Captured Run available" : "No captured Runs yet"}
          </h2>
          <p className="text-sm opacity-75">
            {hasRun
              ? "Open the latest captured Run that references this Prompt."
              : "No captured Run references this Prompt yet."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {hasRun && (
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={onOpenLatest}
            >
              Open latest Run
            </button>
          )}
          {exactPreviewAvailable && (
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={onPreviewExact}
            >
              Preview exact PromptText
            </button>
          )}
        </div>
        {!exactPreviewAvailable && (
          <p className="text-xs opacity-65">
            Connect a compatible application runtime to preview exact
            PromptText.
          </p>
        )}
      </div>
    </section>
  );
}
