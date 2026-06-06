/**
 * Catalog v2 icon set.
 *
 * The design ships its own inline-SVG glyphs (a 24×24 stroke path set)
 * rather than depending on the app's lucide-backed `Icon`. We port that
 * set verbatim so the catalog reads pixel-identically to the handoff and
 * stays self-contained. `CatIcon` adds the catalog-specific glyphs (kind
 * markers) and falls through to the base `Icon` for shared names.
 */

import type { CSSProperties } from 'react'

/** Base shared glyph set (from the design's shared.jsx ICONS). */
export const ICONS: Record<string, string> = {
  search: 'M11 17a6 6 0 100-12 6 6 0 000 12zm5-1l4 4',
  alert: 'M12 3l9 16H3L12 3zm0 6v5m0 2v1',
  sparkle:
    'M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5l-2.5 2.5M10 14l-2.5 2.5m9 0L14 14m-4-4L7.5 7.5',
  trace: 'M4 6h16M4 12h12M4 18h8',
  flask: 'M9 3h6m-5 0v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3',
  layers: 'M3 6l9-4 9 4-9 4-9-4zm0 6l9 4 9-4M3 18l9 4 9-4',
  compare: 'M8 4v16m8-16v16M4 12h4m8 0h4',
  bookmark: 'M6 3h12v18l-6-4-6 4V3z',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l3-9h10l3 9v6H4v-6z',
  cassette:
    'M3 6h18v12H3zM7 12h10M7 10a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z',
  arrowRight: 'M5 12h14m-6-6l6 6-6 6',
  arrowUp: 'M12 19V5m-7 7l7-7 7 7',
  arrowDown: 'M12 5v14m-7-7l7 7 7-7',
  play: 'M6 4l14 8-14 8V4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M6 18L18 6',
  loop: 'M4 12a8 8 0 0114-5l2-2v6h-6l2-2a5 5 0 100 8l1 2a8 8 0 01-13-7z',
  spark: 'M3 17l4-7 5 4 4-9 5 11',
  filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
  diff: 'M9 3v18M15 3v18M4 8l5-5 5 5M14 16l5 5 5-5',
  home: 'M3 12L12 3l9 9v9H3v-9z',
  github:
    'M12 3a9 9 0 00-3 17.5c.5 0 .7-.2.7-.5v-2c-2.7.6-3.4-1-3.4-1-.4-1-1-1.3-1-1.3-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8 0-.7.3-1.1.6-1.4-2.2-.2-4.4-1-4.4-4.7 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1A9 9 0 0112 6c.8 0 1.7.1 2.5.3 1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.4 4.7.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A9 9 0 0012 3z',
  book: 'M4 4h11a3 3 0 013 3v14H7a3 3 0 01-3-3V4zm0 14a3 3 0 013-3h11',
  brain:
    'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h6a3 3 0 003-3 3 3 0 002-5 3 3 0 00-2-5 3 3 0 00-3-3H9zm0 0v16',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  tasks: 'M4 6h2l1 1 2-3M4 12h2l1 1 2-3M4 18h2l1 1 2-3M12 6h9M12 12h9M12 18h9',
  doc: 'M7 3h8l4 4v14H7V3zm8 0v5h5',
  link: 'M10 14a4 4 0 005.5.5l3-3a4 4 0 00-5.5-5.5l-1 1m-.5 7.5a4 4 0 01-5.5-.5l-3-3a4 4 0 015.5-5.5l1 1',
  db: 'M4 6c0-1.5 4-3 8-3s8 1.5 8 3v12c0 1.5-4 3-8 3s-8-1.5-8-3V6zm0 0c0 1.5 4 3 8 3s8-1.5 8-3M4 12c0 1.5 4 3 8 3s8-1.5 8-3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  bot: 'M9 7V4m6 3V4M7 7h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2zm2 5h.01M15 12h.01',
  branch:
    'M6 3v18M6 9a3 3 0 003 3h6a3 3 0 013 3v6m0-15a3 3 0 11-6 0 3 3 0 016 0z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  pin: 'M12 2v8M8 10h8l-1 6h-6l-1-6zm4 6v6',
}

/** Catalog-specific kind glyphs (from the design's catalog-kit.jsx). */
export const CAT_ICONS: Record<string, string> = {
  tool: 'M14.6 5.6a3.4 3.4 0 00-4.5 4.3L4 16l2.1 2.1 6.1-6.1a3.4 3.4 0 004.3-4.5l-2.1 2.1-2-2 2.2-2z',
  flow: 'M5 5h4.5v4H5zM14.5 15h4.5v4h-4.5zM7.2 9v2.5a2 2 0 002 2H15',
  step: 'M5 12h14M13 6l6 6-6 6',
  parallel: 'M6 4v16M12 4v16M18 4v16',
  pipeline: 'M3.5 10h3v4h-3zM10.5 10h3v4h-3zM17.5 10h3v4h-3zM6.5 12h4M13.5 12h4',
  stage: 'M4 9h7v6H4zM11 12h8m-3-3l3 3-3 3',
  swarm: 'M12 9.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8M12 9.6V5M12 14.4V19M9.6 12H5M14.4 12H19',
  consensus: 'M12 21a9 9 0 110-18 9 9 0 010 18zM8.4 12l2.5 2.5 4.7-5.2',
  router: 'M4 12h4m0 0l5-5h7m-12 5l5 5h7',
  route: 'M5 16h6a3 3 0 003-3V8m0 0l-3 3m3-3l3 3',
  cascade: 'M4 6h4v4h4v4h4v4h4',
  tier: 'M5 6h14M7 11h10M9 16h6',
  fallback: 'M5 9h9a4 4 0 110 8H8m3-3l-3 3 3 3',
  option: 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5M2.5 12H7m10 0h4.5',
  block: 'M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6z',
  shield: 'M12 3.2l7 3v5c0 4.4-3 7.5-7 8.8-4-1.3-7-4.4-7-8.8v-5l7-3z',
  lock: 'M7 10.5V8a5 5 0 0110 0v2.5M5.5 10.5h13v9h-13z',
  gauge: 'M4 16a8 8 0 0116 0M12 16l4.5-4.5M4 16h2.4M17.6 16H20',
  dataset: 'M4 6h16v3.5H4zM4 10.5h16V14H4zM4 15h16v3.5H4z',
  case: 'M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 13l2 2 4-4',
  gitcompare:
    'M7 5a2 2 0 100 4 2 2 0 000-4zM7 9v6a2 2 0 002 2h4M17 19a2 2 0 100-4 2 2 0 000 4zm0-4V9a2 2 0 00-2-2h-4',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4a5 5 0 100 10 5 5 0 000-10zm0 4a1 1 0 100 2 1 1 0 000-2z',
  zap: 'M13 3L4 14h6l-1 7 9-11h-6l1-7z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm10 3a3 3 0 100-6 3 3 0 000 6z',
  shuffle: 'M3 6h4l10 12h4M17 4l3 2-3 2M3 18h4l3-3.5M14 8l3-2.5',
  hash: 'M9 4L7 20M17 4l-2 16M4 9h16M3 15h16',
}

export interface IconProps {
  name: string
  size?: number
  color?: string
  strokeWidth?: number
  style?: CSSProperties
}

export function Icon({ name, size = 14, color, strokeWidth = 1.6, style }: IconProps) {
  const d = ICONS[name]
  if (!d) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={d} />
    </svg>
  )
}

export function CatIcon({ name, size = 14, color, strokeWidth = 1.6, style }: IconProps) {
  const d = CAT_ICONS[name]
  if (!d) return <Icon name={name} size={size} color={color} strokeWidth={strokeWidth} style={style} />
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={d} />
    </svg>
  )
}
