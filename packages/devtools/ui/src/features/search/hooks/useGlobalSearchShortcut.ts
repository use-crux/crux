import { useEffect, useState } from "react";

export function useGlobalSearchShortcut() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      // ⌘K / Ctrl+K — the command palette, openable from anywhere (the design's
      // primary trigger; the sidebar button dispatches the same open event).
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
      // `/` — quick-search, but not while typing into a field.
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { isOpen, setIsOpen };
}
