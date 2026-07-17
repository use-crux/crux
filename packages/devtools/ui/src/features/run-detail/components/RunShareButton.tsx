/**
 * Run permalink — the run-header **Share** action (design `dx-workbench`
 * `RunDetailTriage` permalink popover, spec §3 / RUN-DETAIL-SPEC §7).
 *
 * Single-developer framing — "pin your spot." Rather than silently copying,
 * Share opens a popover that exposes the deep-link scheme (`traceId` +
 * `spanId` + `lens`, each part labelled) with one Copy-link action. The URL
 * is produced by the existing nav codec, so opening it restores the run,
 * the selected span, and the active lens exactly. `⌘⇧C` copies directly
 * (wired in `RunDetailShell`, where the selection is in scope).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Eyebrow } from "@/qw/shell/primitives";
import { Icon } from "@/qw/shell/Icon";
import { useToast } from "@/qw/shell/useToast";
import { pathFromState } from "@/app/navigation/useNavigation";
import type { RunLens } from "@/features/run-detail/types";

export interface RunPermalinkParts {
  traceId: string;
  lens: RunLens;
  spanId?: string;
}

/** Absolute deep-link URL for a run + selection + lens, via the nav codec
 *  (so it round-trips through `stateFromPath`). Shared with the `⌘⇧C`
 *  handler in `RunDetailShell`. */
export function buildRunPermalink({
  traceId,
  lens,
  spanId,
}: RunPermalinkParts): string {
  const path = pathFromState({ view: "run-detail", traceId, lens, spanId });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path}`;
}

export function RunShareButton({ traceId, lens, spanId }: RunPermalinkParts) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const url = buildRunPermalink({ traceId, lens, spanId });

  // Close on outside click or Escape — the popover is a transient surface,
  // never a destination.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(url);
    toast({
      kind: "ok",
      title: "Permalink copied",
      message: "Restores run · selection · lens.",
    });
    setOpen(false);
  }, [url, toast]);

  return (
    <div className="relative" ref={ref}>
      <Btn
        size="sm"
        icon={<Icon name="arrowUp" size={13} />}
        onClick={() => setOpen((o) => !o)}
      >
        Share
      </Btn>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-[332px] rounded-[10px] p-4"
          style={{
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
            boxShadow: "0 12px 32px oklch(0% 0 0 / 0.28)",
          }}
        >
          <Eyebrow>Permalink · run + selection + lens</Eyebrow>

          {/* The scheme, colourised by part — the value is copyable verbatim. */}
          <div
            className="mt-2.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-[7px] px-2.5 py-2 font-mono text-[11.5px]"
            style={{
              background: "var(--qw-bg)",
              border: "1px solid var(--qw-border)",
              color: "var(--qw-fg)",
            }}
            title={url}
          >
            /runs/
            <span style={{ color: "var(--qw-crux)" }}>
              {traceId.slice(0, 12)}
            </span>
            {spanId && (
              <>
                ?spanId=
                <span style={{ color: "var(--qw-crux)" }}>
                  {spanId.slice(0, 12)}
                </span>
              </>
            )}
            {lens !== "tree" && (
              <>
                {spanId ? "&" : "?"}lens=
                <span style={{ color: "var(--qw-crux)" }}>{lens}</span>
              </>
            )}
          </div>

          <div
            className="mt-2 flex gap-2.5 font-mono text-[10.5px]"
            style={{ color: "var(--qw-fg-faint)" }}
          >
            <span>run</span>
            <span>· selection</span>
            <span>· lens — restored exactly</span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Btn
              size="xs"
              variant="soft"
              icon={<Icon name="link" size={12} />}
              onClick={copy}
            >
              Copy link
            </Btn>
            <span
              className="font-mono text-[10.5px]"
              style={{ color: "var(--qw-fg-faint)" }}
            >
              ⌘⇧C
            </span>
            <div className="flex-1" />
            <span
              className="text-[10.5px]"
              style={{ color: "var(--qw-fg-faint)" }}
            >
              paste into issues · notes · commits
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
