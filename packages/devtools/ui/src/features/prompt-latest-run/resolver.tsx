import { useEffect, useState } from "react";

import { fetchPromptLatestRun } from "./service";
import type { PromptLatestRunResponse } from "./types";

interface ResolverPorts {
  readonly request?: typeof fetchPromptLatestRun;
  readonly replace?: (path: string) => void;
}

/**
 * Pull and consume one click-time latest-Run resolution.
 *
 * Found and empty results replace the transient resolver entry. Unavailable,
 * error, aborted, and retired results never mutate navigation. No response is
 * cached or retained outside the current call.
 */
export async function resolvePromptLatestRun(
  definitionId: string,
  signal: AbortSignal,
  ports: ResolverPorts = {},
): Promise<PromptLatestRunResponse | undefined> {
  const request = ports.request ?? fetchPromptLatestRun;
  const response = await request(definitionId, signal);
  if (signal.aborted) return undefined;
  if (response.status === "found" || response.status === "empty") {
    (ports.replace ?? replaceCurrentPath)(response.path);
  }
  return response;
}

/**
 * Render the transient latest-Run route. Mount owns exactly one request;
 * unmount aborts it and late outcomes are discarded by the request signal.
 */
export function PromptLatestRunResolver({
  definitionId,
}: {
  readonly definitionId: string;
}) {
  const [message, setMessage] = useState("Opening latest Run…");

  useEffect(() => {
    const controller = new AbortController();
    void resolvePromptLatestRun(definitionId, controller.signal)
      .then((response) => {
        if (
          !controller.signal.aborted &&
          response &&
          (response.status === "unavailable" || response.status === "error")
        ) {
          setMessage(response.message);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMessage("Latest Run is temporarily unavailable. Retry.");
        }
      });
    return () => controller.abort();
  }, [definitionId]);

  return (
    <div className="flex min-h-[240px] items-center justify-center p-8 text-sm">
      {message}
    </div>
  );
}

function replaceCurrentPath(path: string): void {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
