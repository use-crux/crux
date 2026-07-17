/**
 * Zustand-backed runtime store for the devtools UI.
 *
 * Wraps the existing pure `devtoolsReducer` (exhaustive `WsEvent`
 * switch, fully typed, tested) as the body of a single `dispatch`
 * action. The store value is the same `DevtoolsState` shape; what
 * changes is how screens subscribe to it.
 *
 * **Why**: with the previous `useReducer` + prop-drilled `flattenState`
 * pattern, every screen re-rendered on every WS event regardless of
 * whether the event touched a slice they read. With Zustand's
 * `useStore(selector)` pattern + `Object.is` comparison and the
 * reducer's existing immutability discipline, screens only re-render
 * when their slice changes.
 *
 * Public surface:
 *   - `useRuntimeStore()` — full state (rarely needed; use a selector)
 *   - Per-slice selector hooks: `useConnected`, `useJudgeEvents`,
 *     `useAgentEvents`. Add new selectors as new readers appear.
 *   - `dispatchRuntime(action)` — non-hook dispatcher for
 *     callers outside React (e.g. the WS message handler).
 */

import { create } from "zustand";
import {
  devtoolsReducer,
  INITIAL_STATE,
  type DevtoolsAction,
  type DevtoolsState,
} from "./devtoolsReducer";

interface RuntimeStore extends DevtoolsState {
  dispatch: (action: DevtoolsAction) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  ...INITIAL_STATE,
  dispatch: (action) =>
    set((state) => {
      // Extract dispatch out; reducer is typed against DevtoolsState
      // (no dispatch field) for testability.
      const next = devtoolsReducer(state, action);
      return next === state ? state : next;
    }),
}));

/** Non-hook dispatcher (for the WS handler in `useDevtools.ts`). */
export function dispatchRuntime(action: DevtoolsAction): void {
  useRuntimeStore.getState().dispatch(action);
}

// ─── Selectors ─────────────────────────────────────────────────────
//
// One hook per slice that screens actually read. Each selector returns
// the slice directly so `useStore(selector)` does an `Object.is`
// comparison against the previous value; the reducer's immutability
// (returns same reference when unchanged) means no re-render for
// unrelated WS events.

export const useConnected = () => useRuntimeStore((s) => s.connected);
export const useHasEverConnected = () =>
  useRuntimeStore((s) => s.hasEverConnected);
export const useDisconnectedAt = () => useRuntimeStore((s) => s.disconnectedAt);
export const useRetryAttempt = () => useRuntimeStore((s) => s.retryAttempt);
export const useJudgeEvents = () =>
  useRuntimeStore((s) => s.runtime.judgeEvents);
export const useAgentEvents = () =>
  useRuntimeStore((s) => s.runtime.agentEvents);
