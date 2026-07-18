/**
 * Animated replay player.
 *
 * Renders the chronological narrative of a run as a play-along timeline:
 *  - scrubber with drag/click to seek
 *  - play/pause + ×1/×2/×4 speed toggle
 *  - events appear progressively as the cursor advances
 *  - rich previews: markdown for generated text, JsonTree for tool/JSON
 *    payloads, structured cards for retrieval hits
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Btn, Chip, SectionHead } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import {
  canonicalKind,
  formatTime,
  kindColor,
  statusTone,
} from "@/features/run-detail/lib/replay-format";
import { ReplayEventRow } from "@/features/run-detail/components/ReplayEventCard";
import type { ReplayEventInput } from "@/features/run-detail/types";

interface ReplayPlayerProps {
  events: readonly ReplayEventInput[];
  durationMs: number;
  segments: readonly {
    id: string;
    kind: string;
    name: string;
    offsetMs: number;
    durationMs: number;
  }[];
  topMeta?: { label: string; value: string }[];
  status: string;
}

export function ReplayPlayer({
  events,
  durationMs,
  segments,
  topMeta,
  status,
}: ReplayPlayerProps) {
  const total = Math.max(
    1,
    durationMs ||
      segments.reduce((acc, s) => Math.max(acc, s.offsetMs + s.durationMs), 0),
  );
  const [cursor, setCursor] = useState(total);
  const [playing, setPlaying] = useState(false);
  const userInteractedRef = useRef(false);
  const [interacted, setInteracted] = useState(false);
  function markInteracted() {
    userInteractedRef.current = true;
    setInteracted(true);
  }

  const isRunning = status === "running";
  // Live mode = the run is still in flight AND the user hasn't taken
  // over control yet. While live, the cursor stays glued to the tail
  // and the narrative auto-scrolls.
  const live = isRunning && !interacted;

  // Snap the cursor to the new total when it changes upward (e.g. when
  // spans/events arrive after the first render), unless the user has
  // already pressed play / scrubbed.
  useEffect(() => {
    if (!userInteractedRef.current && !playing) {
      setCursor(total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const narrativeEndRef = useRef<HTMLDivElement | null>(null);
  // Default to hiding noise (folded context resolves, convex boundary
  // operation spans, no-op memory polls). User can flip a toggle in the
  // narrative section head to reveal them.
  const [showNoise, setShowNoise] = useState(false);
  const noiseCount = useMemo(
    () => events.reduce((n, e) => n + (e.noise ? 1 : 0), 0),
    [events],
  );

  // Drive the cursor while playing
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    lastTickRef.current = performance.now();
    function tick(now: number) {
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      setCursor((c) => {
        const next = c + dt * speed;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
      animRef.current = raf;
    }
    raf = requestAnimationFrame(tick);
    animRef.current = raf;
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, speed, total]);

  const visibleEvents = useMemo(
    () => events.filter((e) => e.tMs <= cursor && (showNoise || !e.noise)),
    [events, cursor, showNoise],
  );
  const nextEvent = useMemo(
    () => events.find((e) => e.tMs > cursor && (showNoise || !e.noise)),
    [events, cursor, showNoise],
  );

  // Chat-style autoscroll: whenever the visible event count grows, snap
  // the narrative scroll container to the bottom so the newest entry is
  // in view. Fires for both modes:
  //   - Live tailing (run still in flight, server pushing new events)
  //   - Replay playback (cursor advancing past more events)
  //
  // Skips the *initial* render so opening an already-completed run
  // doesn't jerk the user to the tail. Also skips when the user is
  // scrolled up — we don't want to yank them away from older context
  // mid-read. They opt back in by pressing "resume live" or scrolling
  // back to the bottom.
  const lastSeenCountRef = useRef(visibleEvents.length);
  const hasMountedRef = useRef(false);
  const userScrolledUpRef = useRef(false);

  // Track whether the user has scrolled away from the tail. When they
  // scroll back within ~80px of the bottom we re-enable autoscroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 80;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Chat-style scroll-stick. Run *before* paint so the tail is already in
  // view the same frame the newly-appended event renders — no flash of the
  // scroll lagging behind.
  //
  // Deliberately status-agnostic: a planning/in-flight run can report any
  // of several non-terminal statuses, and `live` only tracks the narrow
  // `running` case. Rather than guess the status, we stick to the tail
  // whenever (a) the visible event count grew and (b) the reader is already
  // near the bottom — exactly how a chat transcript behaves. Scrolling up
  // to revisit earlier context pauses the follow until they return.
  useLayoutEffect(() => {
    // Live mode also drags the cursor to the tail.
    if (live && cursor < total) setCursor(total);

    const el = scrollRef.current;
    const grew = visibleEvents.length > lastSeenCountRef.current;
    lastSeenCountRef.current = visibleEvents.length;

    // First render: an in-flight run opens glued to the tail (like opening
    // a chat); a freshly-loaded completed run stays where it is so we don't
    // yank the reader to the bottom of a finished transcript.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (live && el) el.scrollTop = el.scrollHeight;
      return;
    }
    if (!grew || !el) return;
    if (userScrolledUpRef.current) return;
    // Instant pin (not smooth): events stream in rapid bursts while a run
    // is planning, and a smooth scroll would be interrupted by the next
    // event before it reaches the bottom, leaving the view stalled short
    // of the tail. Setting scrollTop jumps straight there (clamped to max).
    el.scrollTop = el.scrollHeight;
  }, [live, visibleEvents.length, total, cursor]);

  const cursorPct = Math.min(100, Math.max(0, (cursor / total) * 100));

  function seekTo(clientX: number) {
    markInteracted();
    const el = scrubberRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setCursor(pct * total);
  }

  function togglePlay() {
    markInteracted();
    if (cursor >= total) setCursor(0);
    setPlaying((p) => !p);
  }

  function resumeLive() {
    userInteractedRef.current = false;
    userScrolledUpRef.current = false;
    setInteracted(false);
    setPlaying(false);
    setCursor(total);
    requestAnimationFrame(() => {
      narrativeEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
  }

  return (
    <div
      ref={scrollRef}
      className="mx-auto h-full overflow-auto"
      style={{ maxWidth: 1120 }}
    >
      {/* Sticky scrubber section — events scroll up and disappear behind it.
          We wrap the card in a full-width band that owns the page background
          so any narrative scrolling underneath gets covered cleanly. */}
      <div
        className="sticky top-0 z-20 px-8 pt-6 pb-4"
        style={{ background: "var(--devtools-bg)" }}
      >
        {/* Scrubber card */}
        <div
          className="rounded-[12px] px-[18px] py-4"
          style={{
            background: "var(--devtools-bg-elev)",
            border: "1px solid var(--devtools-border)",
            boxShadow: "0 8px 30px var(--devtools-crux-glow)",
          }}
        >
          <div className="mb-3 flex items-center gap-3.5">
            <button
              onClick={togglePlay}
              className="flex size-[34px] items-center justify-center rounded-full transition-opacity hover:opacity-90"
              style={{ background: "var(--devtools-crux)", color: "var(--devtools-bg)" }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 24 24"
                  fill="var(--devtools-bg)"
                >
                  <rect x={6} y={4} width={4} height={16} rx={1} />
                  <rect x={14} y={4} width={4} height={16} rx={1} />
                </svg>
              ) : (
                <Icon name="play" size={14} color="var(--devtools-bg)" />
              )}
            </button>
            <span className="font-mono text-[12px] font-semibold">
              {live ? (
                <span style={{ color: "var(--devtools-crux)" }}>now</span>
              ) : (
                <>
                  {formatTime(cursor)} / {formatTime(total)}
                </>
              )}
            </span>
            {live ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
                style={{
                  background: "var(--devtools-crux-soft)",
                  color: "var(--devtools-crux)",
                  boxShadow: "inset 0 0 0 1px var(--devtools-crux-line)",
                }}
                title="Streaming live from a running run"
              >
                <span
                  className="inline-block size-[6px] rounded-full animate-running-pulse"
                  style={{ background: "var(--devtools-crux)" }}
                />
                live
              </span>
            ) : (
              <Chip tone={statusTone(status)} dot>
                {status}
              </Chip>
            )}
            {!live && (
              <button
                onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}
                className="rounded-[4px] px-1.5 py-0.5 font-mono text-[11px]"
                style={{
                  background: "var(--devtools-bg-muted)",
                  color: "var(--devtools-fg-muted)",
                  boxShadow: "inset 0 0 0 1px var(--devtools-border)",
                }}
                title="Playback speed"
              >
                ×{speed.toFixed(1)}
              </button>
            )}
            {isRunning && interacted && (
              <button
                onClick={resumeLive}
                className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: "var(--devtools-crux)",
                  color: "var(--devtools-bg)",
                }}
                title="Stick to the tail of the live run"
              >
                <span
                  className="inline-block size-[6px] rounded-full"
                  style={{ background: "var(--devtools-bg)" }}
                />
                resume live
              </button>
            )}
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {topMeta?.map((m) => `${m.value}`).join(" · ")}
            </span>
          </div>
          <div
            ref={scrubberRef}
            className="relative h-[32px] cursor-pointer select-none"
            onMouseDown={(e) => {
              setPlaying(false);
              seekTo(e.clientX);
              const move = (mv: MouseEvent) => seekTo(mv.clientX);
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          >
            <div
              className="absolute inset-x-0 inset-y-3.5 rounded-[4px]"
              style={{ background: "var(--devtools-bg-muted)" }}
            />
            {segments.map((s) => {
              const left = (s.offsetMs / total) * 100;
              const width = Math.max(0.5, (s.durationMs / total) * 100);
              return (
                <div
                  key={s.id}
                  className="absolute inset-y-1.5 rounded-[4px]"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: kindColor(s.kind),
                    opacity: 0.85,
                    boxShadow: "inset 0 0 0 1px var(--devtools-bg-elev)",
                  }}
                  title={`${s.name} · ${formatTime(s.durationMs)}`}
                />
              );
            })}
            <div
              className="pointer-events-none absolute inset-y-0 w-px"
              style={{
                left: `${cursorPct}%`,
                background: "var(--devtools-crux)",
                boxShadow: `0 0 8px var(--devtools-crux)`,
              }}
            />
            <div
              className="pointer-events-none absolute top-1.5 size-3 rounded-full"
              style={{
                left: `calc(${cursorPct}% - 6px)`,
                background: "var(--devtools-crux)",
                border: "2px solid var(--devtools-bg-elev)",
              }}
            />
          </div>
          {/* Legend + step controls */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {Array.from(
              new Set(segments.map((s) => canonicalKind(s.kind) || s.kind)),
            ).map((k) => (
              <div
                key={k}
                className="flex items-center gap-1.5 font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                <span
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: kindColor(k) }}
                />
                {k}
              </div>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => {
                markInteracted();
                setPlaying(false);
                const prev = [...events]
                  .reverse()
                  .find((e) => e.tMs < cursor - 1);
                setCursor(prev ? prev.tMs : 0);
              }}
              className="rounded-[6px] px-2 py-1 font-mono text-[11px]"
              style={{
                color: "var(--devtools-fg)",
                background: "var(--devtools-bg-elev)",
                boxShadow: "inset 0 0 0 1px var(--devtools-border)",
              }}
              title="Previous event"
            >
              ←
            </button>
            <button
              onClick={() => {
                markInteracted();
                setPlaying(false);
                const next = events.find((e) => e.tMs > cursor);
                setCursor(next ? next.tMs : total);
              }}
              className="rounded-[6px] px-2 py-1 font-mono text-[11px]"
              style={{
                color: "var(--devtools-fg)",
                background: "var(--devtools-bg-elev)",
                boxShadow: "inset 0 0 0 1px var(--devtools-border)",
              }}
              title="Next event"
            >
              →
            </button>
            <button
              onClick={() => {
                markInteracted();
                setPlaying(false);
                setCursor(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 font-mono text-[11px]"
              style={{
                color: "var(--devtools-fg)",
                background: "var(--devtools-bg-elev)",
                boxShadow: "inset 0 0 0 1px var(--devtools-border)",
              }}
              title="Restart"
            >
              <Icon name="loop" size={11} /> restart
            </button>
          </div>
        </div>
      </div>

      {/* Narrative — scrolls under the sticky player */}
      <div className="px-8 pb-12">
        <SectionHead
          eyebrow={
            live
              ? `Live · ${visibleEvents.length} event${visibleEvents.length === 1 ? "" : "s"} so far`
              : playing
                ? `Replaying · ${visibleEvents.length} / ${events.length - (showNoise ? 0 : noiseCount)}`
                : `Narrative · ${events.length - (showNoise ? 0 : noiseCount)} events`
          }
          right={
            <span className="flex items-center gap-3">
              {noiseCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowNoise((v) => !v)}
                  className="font-mono text-[11px] hover:opacity-80"
                  style={{
                    color: showNoise ? "var(--devtools-crux)" : "var(--devtools-fg-faint)",
                  }}
                  title={
                    showNoise
                      ? "Hide folded context resolves + boundary spans"
                      : "Show folded context resolves + boundary spans"
                  }
                >
                  {showNoise
                    ? `hide ${noiseCount} folded`
                    : `show ${noiseCount} folded`}
                </button>
              )}
              {live ? (
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--devtools-crux)" }}
                >
                  tailing… switch to{" "}
                  <span style={{ fontWeight: 600 }}>Inspect</span> for waterfall
                </span>
              ) : nextEvent ? (
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  next · {nextEvent.kind} at +{Math.round(nextEvent.tMs)}ms
                </span>
              ) : null}
            </span>
          }
        />

        <div className="flex flex-col gap-0">
          {visibleEvents.map((e, i) => (
            <ReplayEventRow key={i} event={e} dim={e.noise} />
          ))}
          {visibleEvents.length === 0 && (
            <div
              className="rounded-[10px] px-6 py-10 text-center text-[13px]"
              style={{
                background: "var(--devtools-bg-elev)",
                border: "1px dashed var(--devtools-border)",
                color: "var(--devtools-fg-muted)",
              }}
            >
              {live
                ? "Waiting for the first event…"
                : "Press play to step through the run."}
            </div>
          )}
          {live && visibleEvents.length > 0 && (
            <div
              className="ml-[120px] mt-2 inline-flex items-center gap-1.5 self-start rounded-[6px] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em]"
              style={{
                color: "var(--devtools-crux)",
                background: "var(--devtools-crux-soft)",
                border: "1px dashed var(--devtools-crux-line)",
              }}
            >
              <span
                className="inline-block size-[6px] rounded-full animate-running-pulse"
                style={{ background: "var(--devtools-crux)" }}
              />
              tailing live
            </div>
          )}
          <div ref={narrativeEndRef} aria-hidden style={{ height: 1 }} />
        </div>
      </div>
    </div>
  );
}
