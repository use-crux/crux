/**
 * Index v2 — architecture graph (relations as nodes + edges).
 *
 * Ported from the design's index-graph.jsx. Standalone definitions are
 * nodes; semantic relations are edges. Containment edges (includes_step,
 * uses_store, …) are "lifted" onto the parent so the graph reads at the
 * architecture level. Deterministic force layout, pan/zoom, family filter,
 * neighbour highlighting, and a side drawer that can open the full detail.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { T, toneColor } from "./tokens";
import { Icon } from "./icons";
import { Btn } from "./primitives";
import {
  INDEX_FAMILY_ORDER,
  KindBadge,
  KindGlyph,
  familyMeta,
  kindMeta,
  type FamilyId,
} from "./kit";
import type { IndexIndex } from "./adapt";
import { useIndexIndex } from "./context";

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// containment / structural relation types are lifted, not drawn as edges
const GRAPH_STRUCTURAL =
  /includes_step|includes_route|includes_tier|includes_option|includes_block|includes_case|uses_store|storage\.bundle\.uses_(record|vector|asset)_store|storage\.scope\.wraps_storage/;

interface GNode {
  id: string;
  kind: string;
  name: string;
  family: FamilyId | null;
}
interface GEdge {
  from: string;
  to: string;
  type: string;
  fidelity: string;
  count: number;
}
interface GModel {
  nodes: GNode[];
  edges: GEdge[];
}
interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function liftId(idx: IndexIndex, id: string): string {
  let d = idx.byId(id);
  let guard = 0;
  while (
    d &&
    d.presentation &&
    d.presentation.parentDefinitionId &&
    guard++ < 6
  ) {
    d = idx.byId(d.presentation.parentDefinitionId);
  }
  return d ? d.id : id;
}

function buildGraphModel(idx: IndexIndex): GModel {
  const nodes: GNode[] = idx.standalone.map((d) => ({
    id: d.id,
    kind: d.kind,
    name: d.name,
    family: kindMeta(d.kind).family,
  }));
  const nodeSet = new Set(nodes.map((n) => n.id));
  const seen: Record<string, GEdge> = {};
  const edges: GEdge[] = [];
  for (const r of idx.relations) {
    if (GRAPH_STRUCTURAL.test(r.type)) continue;
    const from = liftId(idx, r.from);
    const to = liftId(idx, r.to);
    if (from === to || !nodeSet.has(from) || !nodeSet.has(to)) continue;
    const key = `${from}|${to}`;
    if (seen[key]) {
      seen[key].count++;
      continue;
    }
    const e: GEdge = { from, to, type: r.type, fidelity: r.fidelity, count: 1 };
    seen[key] = e;
    edges.push(e);
  }
  return { nodes, edges };
}

function forceLayout(
  nodes: GNode[],
  edges: GEdge[],
  W: number,
  H: number,
  iterations: number,
): Record<string, Pos> {
  const rng = mulberry32(1337);
  const pos: Record<string, Pos> = {};
  const N = nodes.length;
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    pos[n.id] = {
      x: W / 2 + Math.cos(a) * 260 + (rng() - 0.5) * 40,
      y: H / 2 + Math.sin(a) * 220 + (rng() - 0.5) * 40,
      vx: 0,
      vy: 0,
    };
  });
  const REP = 5200;
  const SPRING = 0.012;
  const LEN = 130;
  const CENTER = 0.006;
  const DAMP = 0.86;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < N; i++) {
      const pa = pos[nodes[i].id];
      for (let j = i + 1; j < N; j++) {
        const pb = pos[nodes[j].id];
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const f = REP / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        pa.vx += fx;
        pa.vy += fy;
        pb.vx -= fx;
        pb.vy -= fy;
      }
    }
    edges.forEach((e) => {
      const pa = pos[e.from];
      const pb = pos[e.to];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - LEN) * SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      pa.vx += fx;
      pa.vy += fy;
      pb.vx -= fx;
      pb.vy -= fy;
    });
    nodes.forEach((n) => {
      const p = pos[n.id];
      p.vx += (W / 2 - p.x) * CENTER;
      p.vy += (H / 2 - p.y) * CENTER;
      p.vx *= DAMP;
      p.vy *= DAMP;
      p.x += p.vx;
      p.y += p.vy;
    });
  }
  return pos;
}

export function IndexGraph({
  onOpenDetail,
  initialSelected,
}: {
  onOpenDetail?: (id: string) => void;
  initialSelected?: string | null;
}) {
  const idx = useIndexIndex();
  const [fams, setFams] = useState<Set<FamilyId>>(
    () => new Set(INDEX_FAMILY_ORDER),
  );
  const [selected, setSelected] = useState<string | null>(
    initialSelected ?? null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null,
  );
  const W = 1400;
  const H = 900;

  const model = useMemo(() => buildGraphModel(idx), [idx]);
  const visNodes = model.nodes.filter((n) => !n.family || fams.has(n.family));
  const visSet = new Set(visNodes.map((n) => n.id));
  const visEdges = model.edges.filter(
    (e) => visSet.has(e.from) && visSet.has(e.to),
  );
  const pos = useMemo(
    () => forceLayout(model.nodes, model.edges, W, H, 320),
    [model],
  );

  const focus = hover ?? selected;
  const nbr = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    visEdges.forEach((e) => {
      if (e.from === focus) s.add(e.to);
      if (e.to === focus) s.add(e.from);
    });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, fams]);

  const fit = useCallback(() => {
    if (!visNodes.length) return;
    const xs = visNodes.map((n) => pos[n.id].x);
    const ys = visNodes.map((n) => pos[n.id].y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX + 160;
    const h = maxY - minY + 160;
    const s = Math.min(1.4, Math.min(1180 / w, 720 / h));
    setView({ s, x: -minX * s + 80, y: -minY * s + 70 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, fams]);
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const ds = e.deltaY < 0 ? 1.1 : 0.9;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const ns = Math.max(0.3, Math.min(3, v.s * ds));
      return {
        s: ns,
        x: mx - (mx - v.x) * (ns / v.s),
        y: my - (my - v.y) * (ns / v.s),
      };
    });
  };
  const onDown = (e: ReactMouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMove = (e: ReactMouseEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => ({
      ...v,
      x: d.vx + (e.clientX - d.x),
      y: d.vy + (e.clientY - d.y),
    }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const sel = selected ? idx.byId(selected) : undefined;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        position: "relative",
        minHeight: 0,
      }}
    >
      {/* controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: `1px solid ${T.border}`,
          flex: "0 0 auto",
          flexWrap: "wrap",
        }}
      >
        <Icon name="grid" size={15} color={T.crux} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Architecture graph
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
          {visNodes.length} nodes · {visEdges.length} edges
        </span>
        <div
          style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: 10 }}
        >
          {INDEX_FAMILY_ORDER.map((fam) => {
            const on = fams.has(fam);
            const c = toneColor(T, familyMeta(fam).tone);
            return (
              <button
                key={fam}
                type="button"
                onClick={() =>
                  setFams((s) => {
                    const n = new Set(s);
                    if (n.has(fam)) n.delete(fam);
                    else n.add(fam);
                    return n;
                  })
                }
                title={familyMeta(fam).label}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 99,
                  fontSize: 10.5,
                  color: on ? c.fg : T.fgFaint,
                  background: on ? c.soft : "transparent",
                  boxShadow: `inset 0 0 0 1px ${on ? c.line : T.border}`,
                  opacity: on ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: on ? c.fg : T.fgFaint,
                  }}
                />
                {familyMeta(fam).label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Btn
            size="xs"
            onClick={() =>
              setView((v) => ({ ...v, s: Math.min(3, v.s * 1.2) }))
            }
          >
            +
          </Btn>
          <Btn
            size="xs"
            onClick={() =>
              setView((v) => ({ ...v, s: Math.max(0.3, v.s / 1.2) }))
            }
          >
            −
          </Btn>
          <Btn size="xs" icon="home" onClick={fit}>
            Fit
          </Btn>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* canvas */}
        <div
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          style={{
            flex: 1,
            minWidth: 0,
            position: "relative",
            overflow: "hidden",
            cursor: drag.current ? "grabbing" : "grab",
            backgroundImage: `radial-gradient(${T.grid} 1px, transparent 1px)`,
            backgroundSize: "26px 26px",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${view.x}px,${view.y}px) scale(${view.s})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              width={W}
              height={H}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              {visEdges.map((e, i) => {
                const a = pos[e.from];
                const b = pos[e.to];
                const fromNode = idx.byId(e.from);
                const c = toneColor(
                  T,
                  fromNode ? kindMeta(fromNode.kind).tone : "muted",
                );
                const active = focus && (e.from === focus || e.to === focus);
                const dim = focus && !active;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2 - 18;
                return (
                  <g key={i} opacity={dim ? 0.08 : active ? 1 : 0.34}>
                    <path
                      d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
                      fill="none"
                      stroke={c.fg}
                      strokeWidth={active ? 1.8 : 1}
                    />
                    {active && <circle cx={b.x} cy={b.y} r={3} fill={c.fg} />}
                  </g>
                );
              })}
            </svg>
            {visNodes.map((n) => {
              const p = pos[n.id];
              const c = toneColor(T, kindMeta(n.kind).tone);
              const on = selected === n.id;
              const dim = nbr && !nbr.has(n.id);
              return (
                <div
                  key={n.id}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected(n.id)}
                  style={{
                    position: "absolute",
                    left: p.x,
                    top: p.y,
                    transform: "translate(-50%,-50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 9px 4px 5px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: on ? c.soft : T.bgElev,
                    boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? c.fg : c.line}`,
                    opacity: dim ? 0.28 : 1,
                    whiteSpace: "nowrap",
                    zIndex: on ? 5 : 1,
                  }}
                >
                  <KindGlyph kind={n.kind} size={20} />
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontSize: 11,
                      fontWeight: on ? 600 : 450,
                      color: on ? c.fg : T.fg,
                    }}
                  >
                    {n.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* drawer */}
        {sel && (
          <aside
            style={{
              width: 320,
              flex: "0 0 320px",
              borderLeft: `1px solid ${T.border}`,
              background: T.bg,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "16px 18px",
                borderBottom: `1px solid ${T.border}`,
                background: toneColor(T, kindMeta(sel.kind).tone).soft,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <KindGlyph kind={sel.kind} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: T.mono,
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  >
                    {sel.name}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <KindBadge kind={sel.kind} />
                  </div>
                </div>
                <Btn
                  size="xs"
                  icon="x"
                  variant="ghost"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setSelected(null)}
                >
                  Close
                </Btn>
              </div>
              {sel.description && (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontFamily: T.serif,
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: T.fgMuted,
                  }}
                >
                  {sel.description}
                </p>
              )}
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: "14px 18px",
              }}
            >
              {(["outgoing", "incoming"] as const).map((dir) => {
                const es = visEdges.filter(
                  (e) => (dir === "outgoing" ? e.from : e.to) === sel.id,
                );
                if (!es.length) return null;
                return (
                  <div key={dir} style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: T.fgFaint,
                        fontWeight: 500,
                        marginBottom: 8,
                      }}
                    >
                      {dir === "outgoing" ? "Depends on" : "Used by"} ·{" "}
                      {es.length}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      {es.map((e, i) => {
                        const oid = dir === "outgoing" ? e.to : e.from;
                        const od = idx.byId(oid);
                        if (!od) return null;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelected(oid)}
                            style={{
                              all: "unset",
                              cursor: "pointer",
                              display: "grid",
                              gridTemplateColumns: "20px 1fr auto",
                              gap: 8,
                              alignItems: "center",
                              padding: "6px 8px",
                              background: T.bgElev,
                              border: `1px solid ${T.border}`,
                              borderRadius: 7,
                            }}
                          >
                            <KindGlyph kind={od.kind} size={20} />
                            <span
                              style={{
                                fontFamily: T.mono,
                                fontSize: 11.5,
                                color: T.fg,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {od.name}
                            </span>
                            <span
                              style={{
                                fontFamily: T.mono,
                                fontSize: 9,
                                color: T.fgFaint,
                              }}
                            >
                              {e.type.replace(/_/g, " ")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {onOpenDetail && (
                <Btn
                  size="md"
                  variant="primary"
                  iconRight="arrowRight"
                  onClick={() => onOpenDetail(sel.id)}
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    marginTop: 4,
                  }}
                >
                  Open detail
                </Btn>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
