import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeStatusResponse } from "../types";
import { RuntimeView } from "./RuntimeView";

const state = vi.hoisted(() => ({
  status: undefined as RuntimeStatusResponse | undefined,
  tab: "transports" as "work" | "timers" | "outbox" | "dead-letter" | "transports",
}));

vi.mock("@/devtools/shell/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/devtools/shell/DevtoolsShell", () => ({
  DevtoolsShell: ({
    children,
    tabs,
  }: {
    children: React.ReactNode;
    tabs?: readonly { label: string; onClick?: () => void; active?: boolean }[];
  }) => {
    // Force the Transports tab so empty-state messages are visible under SSR.
    const transports = tabs?.find((tab) => tab.label === "Transports");
    if (transports && !transports.active) {
      transports.onClick?.();
    }
    return <div data-testid="shell">{children}</div>;
  },
}));

vi.mock("../hooks/useRuntime", () => ({
  useRuntimeStatus: () => ({
    data: state.status,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRuntimeInspect: () => ({ data: undefined }),
  useRetryRuntimeWork: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCancelRuntimeWork: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

// RuntimeView owns tab state; re-render after the shell requests Transports.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: ((initial: unknown) => {
      if (initial === "work") {
        return [state.tab, (next: typeof state.tab) => {
          state.tab = typeof next === "function" ? (next as (t: typeof state.tab) => typeof state.tab)(state.tab) : next;
        }] as const;
      }
      return actual.useState(initial as never);
    }) as typeof actual.useState,
  };
});

describe("RuntimeView transport health empty states", () => {
  beforeEach(() => {
    state.tab = "transports";
    state.status = baseStatus();
  });

  it("shows unavailable health when status omits transports", () => {
    state.status = baseStatus();
    delete (state.status as { transports?: unknown }).transports;

    const html = renderToStaticMarkup(<RuntimeView />);
    expect(html).toContain(
      "Transport health is unavailable for this Runtime status snapshot.",
    );
    expect(html).not.toContain(
      "No managed-transport bindings in the generated Runtime program.",
    );
  });

  it("shows empty bindings when transports snapshot is present but empty", () => {
    state.status = {
      ...baseStatus(),
      transports: {
        schema: 1,
        namespace: "local",
        observedAt: "2026-08-08T12:00:00.000Z",
        bindings: [],
        totals: {
          accepted: 0,
          deduplicated: 0,
          delivered: 0,
          retried: 0,
          deadLettered: 0,
        },
        coverage: {
          bindingLimit: 64,
          bindings: "complete",
          identityAttribution: "complete",
          checkpoints: "available",
          statistics: "missing",
        },
      },
    };

    const html = renderToStaticMarkup(<RuntimeView />);
    expect(html).toContain(
      "No managed-transport bindings in the generated Runtime program.",
    );
    expect(html).not.toContain(
      "Transport health is unavailable for this Runtime status snapshot.",
    );
  });
});

function baseStatus(): RuntimeStatusResponse {
  return {
    operation: "status",
    ok: true,
    namespace: "local",
    counts: [],
    work: [],
    timers: [],
    outbox: [],
  };
}
