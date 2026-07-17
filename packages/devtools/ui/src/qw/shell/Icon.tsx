/**
 * Single-path SVG icon set used across the Quality Workbench.
 *
 * Kept inline (vs. lucide-react) to match the design's editorial weight
 * exactly — 1.6 stroke width, rounded caps, currentColor by default.
 */

import type { IconName } from "./nav";

const PATHS: Record<IconName, string> = {
  home: "M3 12L12 3l9 9v9H3v-9z",
  sparkle:
    "M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5l-2.5 2.5M10 14l-2.5 2.5m9 0L14 14m-4-4L7.5 7.5",
  trace: "M4 6h16M4 12h12M4 18h8",
  layers: "M3 6l9-4 9 4-9 4-9-4zm0 6l9 4 9-4M3 18l9 4 9-4",
  flask: "M9 3h6m-5 0v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3",
  compare: "M8 4v16m8-16v16M4 12h4m8 0h4",
  bookmark: "M6 3h12v18l-6-4-6 4V3z",
  inbox: "M4 13h4l2 3h4l2-3h4M4 13l3-9h10l3 9v6H4v-6z",
  cassette:
    "M3 6h18v12H3zM7 12h10M7 10a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z",
  filter: "M3 5h18l-7 8v6l-4-2v-4L3 5z",
  search: "M11 17a6 6 0 100-12 6 6 0 000 12zm5-1l4 4",
  play: "M6 4l14 8-14 8V4z",
  arrowRight: "M5 12h14m-6-6l6 6-6 6",
  arrowDown: "M12 5v14m-7-7l7 7 7-7",
  arrowUp: "M12 19V5m-7 7l7-7 7 7",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M6 18L18 6",
  loop: "M4 12a8 8 0 0114-5l2-2v6h-6l2-2a5 5 0 100 8l1 2a8 8 0 01-13-7z",
  spark: "M3 17l4-7 5 4 4-9 5 11",
  alert: "M12 3l9 16H3L12 3zm0 6v5m0 2v1",
  diff: "M9 3v18M15 3v18M4 8l5-5 5 5M14 16l5 5 5-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  book: "M4 4h11a3 3 0 013 3v14H7a3 3 0 01-3-3V4zm0 14a3 3 0 013-3h11",
  brain:
    "M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h6a3 3 0 003-3 3 3 0 002-5 3 3 0 00-2-5 3 3 0 00-3-3H9zm0 0v16",
  folder:
    "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  list: "M4 6h16M4 12h16M4 18h10",
  tasks: "M4 6h2l1 1 2-3M4 12h2l1 1 2-3M4 18h2l1 1 2-3M12 6h9M12 12h9M12 18h9",
  doc: "M7 3h8l4 4v14H7V3zm8 0v5h5",
  link: "M10 14a4 4 0 005.5.5l3-3a4 4 0 00-5.5-5.5l-1 1m-.5 7.5a4 4 0 01-5.5-.5l-3-3a4 4 0 015.5-5.5l1 1",
  db: "M4 6c0-1.5 4-3 8-3s8 1.5 8 3v12c0 1.5-4 3-8 3s-8-1.5-8-3V6zm0 0c0 1.5 4 3 8 3s8-1.5 8-3M4 12c0 1.5 4 3 8 3s8-1.5 8-3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  clock: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  branch:
    "M6 3v12m0 0a3 3 0 103 3 3 3 0 00-3-3zM6 6a3 3 0 003 3h6a3 3 0 013 3m0 0a3 3 0 10-3 3 3 3 0 003-3z",
  bot: "M12 3v3m-5 0h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V8a2 2 0 012-2zm2 6v2m4-2v2",
  info: "M12 11v5m0-8h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 14,
  color,
  strokeWidth = 1.6,
  className,
}: IconProps) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
