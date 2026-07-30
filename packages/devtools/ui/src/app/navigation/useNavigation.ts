/**
 * Devtools navigation context.
 *
 * URL encoding and decoding live in focused pure modules; this module owns
 * only the React and browser-history lifecycle.
 */

import {
  createContext,
  createElement,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { NavState } from "./navigation-state";
import { pathFromState } from "./path-from-state";
import { stateFromPath } from "./state-from-path";

export type { NavState } from "./navigation-state";
export { pathFromState } from "./path-from-state";
export { stateFromPath } from "./state-from-path";

type NavDirection = "forward" | "back" | null;

function inferNavDirection(fromPath: string, toPath: string): NavDirection {
  const fromDepth = fromPath.split("/").filter(Boolean).length;
  const toDepth = toPath.split("/").filter(Boolean).length;
  if (toDepth > fromDepth) return "forward";
  if (toDepth < fromDepth) return "back";
  return null;
}

interface DocumentWithViewTransition {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
}

function runViewTransition(direction: NavDirection, update: () => void): void {
  const documentWithTransitions = document as Document &
    DocumentWithViewTransition;
  if (typeof documentWithTransitions.startViewTransition !== "function") {
    update();
    return;
  }
  if (direction) document.documentElement.dataset.navDirection = direction;
  else delete document.documentElement.dataset.navDirection;
  const transition = documentWithTransitions.startViewTransition(() => {
    flushSync(update);
  });
  transition.finished.finally(() => {
    delete document.documentElement.dataset.navDirection;
  });
}

/** Navigation operations exposed to Devtools screens. */
interface NavigationContextValue {
  nav: NavState;
  navigate: (state: NavState) => void;
  /** Whether a React navigation transition is still pending. */
  isNavigating: boolean;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

/** Own URL-backed Devtools navigation for the mounted application. */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState<NavState>(() =>
    stateFromPath(window.location.pathname, window.location.search),
  );
  const [isNavigating, startNavigationTransition] = useTransition();

  const navigate = useCallback((state: NavState) => {
    const path = pathFromState(state);
    const fromPath = window.location.pathname;
    window.history.pushState(state, "", path);
    const direction = inferNavDirection(fromPath, path);
    if (
      typeof (document as Document & DocumentWithViewTransition)
        .startViewTransition === "function"
    ) {
      runViewTransition(direction, () => setNav(state));
    } else {
      startNavigationTransition(() => setNav(state));
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = stateFromPath(
        window.location.pathname,
        window.location.search,
      );
      if (
        typeof (document as Document & DocumentWithViewTransition)
          .startViewTransition === "function"
      ) {
        runViewTransition("back", () => setNav(next));
      } else {
        startTransition(() => setNav(next));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({ nav, navigate, isNavigating }),
    [nav, navigate, isNavigating],
  );
  return createElement(NavigationContext.Provider, { value }, children);
}

/** Read the active Devtools navigation context. */
export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context)
    throw new Error("useNavigation must be used within a NavigationProvider");
  return context;
}
