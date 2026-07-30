import { fetchPromptLatestRun } from "./service";
import type { PromptLatestRunResponse } from "./types";

export interface PromptLatestRunRefresh {
  /** Share the current background pull, or start one when idle. */
  readonly background: () => Promise<PromptLatestRunResponse | undefined>;
  /** Retire background work and perform a new click-time pull. */
  readonly fresh: () => Promise<PromptLatestRunResponse | undefined>;
  /** Abort work and permanently discard every late result. */
  readonly dispose: () => void;
}

/**
 * Create one owner-local refresh coordinator.
 *
 * The coordinator permits one background request, generation-gates every
 * outcome, and retains no response after a request settles.
 */
export function createPromptLatestRunRefresh(
  definitionId: string,
  request: typeof fetchPromptLatestRun = fetchPromptLatestRun,
): PromptLatestRunRefresh {
  let generation = 0;
  let disposed = false;
  let active:
    | {
        readonly generation: number;
        readonly controller: AbortController;
        readonly promise: Promise<PromptLatestRunResponse | undefined>;
      }
    | undefined;

  const begin = (
    retireCurrent: boolean,
  ): Promise<PromptLatestRunResponse | undefined> => {
    if (disposed) return Promise.resolve(undefined);
    if (active && !retireCurrent) return active.promise;
    active?.controller.abort();

    const requestGeneration = ++generation;
    const controller = new AbortController();
    const promise = request(definitionId, controller.signal)
      .then((response) =>
        !disposed &&
        !controller.signal.aborted &&
        generation === requestGeneration
          ? response
          : undefined,
      )
      .catch((error: unknown) => {
        if (
          disposed ||
          controller.signal.aborted ||
          generation !== requestGeneration
        ) {
          return undefined;
        }
        throw error;
      })
      .finally(() => {
        if (active?.generation === requestGeneration) active = undefined;
      });
    active = { generation: requestGeneration, controller, promise };
    return promise;
  };

  return {
    background: () => begin(false),
    fresh: () => begin(true),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active?.controller.abort();
      active = undefined;
    },
  };
}
