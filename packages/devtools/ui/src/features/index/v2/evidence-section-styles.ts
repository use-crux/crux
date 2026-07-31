/** Theme-token-backed layout styles for Catalog execution-evidence sections. */

import { T } from "./tokens";

export const evidenceSectionStyles = {
  panel: {
    padding: 14,
    marginBottom: 22,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    background: T.bgElev,
  },
  factGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
    gap: 8,
  },
  fact: { display: "grid", gap: 3 },
  label: {
    color: T.fgFaint,
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  value: { color: T.fg, fontFamily: T.mono, fontSize: 11 },
  source: {
    display: "block",
    marginTop: 12,
    color: T.fgMuted,
    fontFamily: T.mono,
    fontSize: 11,
  },
  actionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  linkButton: {
    border: `1px solid ${T.border}`,
    borderRadius: 6,
    background: T.bg,
    color: T.crux,
    padding: "5px 9px",
    cursor: "pointer",
    fontSize: 11,
  },
  findings: {
    display: "grid",
    gap: 8,
    marginTop: 12,
    borderTop: `1px solid ${T.border}`,
    paddingTop: 12,
  },
  findingCopy: {
    margin: "6px 0 0",
    color: T.fgMuted,
    fontSize: 11,
  },
  runtime: { color: T.fgFaint, fontSize: 10 },
  roleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
    gap: 8,
  },
  roleCard: {
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    background: T.bg,
    padding: 10,
    minWidth: 0,
  },
  roleTitle: {
    margin: "0 0 8px",
    color: T.fg,
    fontSize: 12,
  },
  entryList: { display: "grid", gap: 8 },
  entry: { display: "grid", gap: 5, minWidth: 0 },
  entryHeading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
  },
  primitive: {
    overflowWrap: "anywhere",
    color: T.fgMuted,
    fontSize: 9.5,
  },
  detail: {
    overflowWrap: "anywhere",
    color: T.fgFaint,
    fontSize: 9.5,
  },
  followUp: { color: T.crux, fontSize: 10 },
} as const;
