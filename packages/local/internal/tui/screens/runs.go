package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Runs screen — three panes laid out per the V1 Panels design:
//
//	┌──────────────┬─────────────────────────────────────────┬──────────────────────┐
//	│ Runs · 1h    │ Trace 8af2…f1c · docs_agent · 14.2s     │ span: retrieve(loop) │
//	│ sort: time ↓ │ 0s  1s  2s  …  14.2s                    │ 9.8s                 │
//	│              │ ◆ agent  docs_agent.run  ━━━━━━━━ 14.20s│ IDENTITY             │
//	│ ● 8af2f1c    │ ├ llm    plan            │       0.62s  │ span_id  b71c…3a4f   │
//	│   docs_agent │ ├ agent  retrieve(loop)  ━━━━━   9.80s  │ parent   8af2…f1c    │
//	│   14.2s      │ ├ tool   rag.search …    │       0.54s  │ kind     agent.sub…  │
//	│   18.4k tok  │ …                                       │ op       agent       │
//	│              │ [↵] expand [o] open [f] flame chart …   │ TIMING   …           │
//	└──────────────┴─────────────────────────────────────────┴──────────────────────┘
//
// Focus moves with h/l. j/k cycles within the focused pane; ↵ activates
// (loads run detail from the list, drills into span detail from the
// waterfall).
type Runs struct {
	runs    []api.QualityRunRecord
	detail  *api.QualityRunDetailRecord
	selRun  string
	selSpan string
	focus   runsFocus
	loaded  bool
	err     string
	loading bool

	runList kit.VList[api.QualityRunRecord]
}

type runsFocus int

const (
	focusRuns runsFocus = iota
	focusWaterfall
	focusSpanDetail
)

func NewRuns() *Runs {
	r := &Runs{}
	r.runList.SetIdentity(func(run api.QualityRunRecord) string { return run.TraceID })
	r.runList.SetRowHeight(func(api.QualityRunRecord) int { return 2 })
	return r
}

func (s *Runs) ID() string { return "runs" }

func (s *Runs) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainRuns)
}

func (s *Runs) Init(c DataClient) tea.Cmd { return fetchRunsList(c) }

func (s *Runs) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case runsListLoadedMsg:
		s.runs = []api.QualityRunRecord(m)
		s.runList.SetItems(s.runs)
		s.loaded = true
		if s.selRun == "" && len(s.runs) > 0 {
			s.selRun = s.runs[0].TraceID
			s.runList.SetCursorByIdentity(s.selRun)
			return fetchRunDetail(c, s.selRun)
		}
		s.runList.SetCursorByIdentity(s.selRun)
	case runDetailLoadedMsg:
		d := api.QualityRunDetailRecord(m)
		// Preserve the user's span selection across refetches when the
		// span still exists.
		prevSel := s.selSpan
		s.detail = &d
		s.loading = false
		s.selSpan = ""
		for _, sp := range d.Spans {
			if sp.ID == prevSel {
				s.selSpan = prevSel
				break
			}
		}
		if s.selSpan == "" && len(d.Spans) > 0 {
			s.selSpan = d.Spans[0].ID
		}
	case dataErrMsg:
		s.err = string(m)
		s.loading = false
	case api.QualityEvent:
		// Typed live event from the bus (also used for the synthesized
		// "store changed" signal — kind=="refresh"). Refresh the run list
		// and refetch the active trace's detail when relevant.
		return s.liveRefresh(c, m.RefID)
	case tea.KeyPressMsg:
		switch m.String() {
		case "j", "down":
			return s.moveDown(c)
		case "k", "up":
			return s.moveUp(c)
		case "h", "left":
			s.shiftFocus(-1)
		case "l", "right":
			s.shiftFocus(+1)
		case "enter":
			return s.activateFocus(c)
		case "i":
			// Raw-inspect overlay (in-TUI JSON pretty-printer). Layer-3
			// per KEYBINDS.md; `o` is reserved for external viewer.
			return s.openInspect()
		case "o":
			// Open in external React devtools UI — stub for now; S7 wires
			// the actual handoff once the URL scheme is documented.
			return nil
		case "e":
			// export: dump the focused run's JSON to
			// ~/.crux/exports/run-{id}.json. No-op if nothing focused.
			return s.exportRun()
		}
	}
	return nil
}

// openInspect emits an InspectRequest carrying the currently-selected
// span's full raw JSON. The workbench catches it and pops the overlay.
func (s *Runs) openInspect() tea.Cmd {
	span := s.currentSpan()
	if span == nil || len(span.Data) == 0 {
		return nil
	}
	title := span.Name
	if title == "" {
		title = span.ID
	}
	subtitle := span.Primitive
	if span.CompositionType != "" {
		subtitle += " · " + span.CompositionType
	}
	payload := span.Data
	return func() tea.Msg {
		return InspectRequest{
			Title:    title,
			Subtitle: subtitle,
			Payload:  []byte(payload),
		}
	}
}

// liveRefresh refetches the runs list and, if the event references the
// currently-selected trace (or the refId is empty so we can't be sure),
// also refetches that trace's detail. Returning batched commands keeps
// the screen in sync without losing focus or selection state.
func (s *Runs) liveRefresh(c DataClient, refID string) tea.Cmd {
	cmds := []tea.Cmd{fetchRunsList(c)}
	if s.selRun != "" && (refID == "" || refID == s.selRun) {
		cmds = append(cmds, fetchRunDetail(c, s.selRun))
	}
	return tea.Batch(cmds...)
}

func (s *Runs) shiftFocus(delta int) {
	next := int(s.focus) + delta
	if next < 0 {
		next = 0
	}
	if next > int(focusSpanDetail) {
		next = int(focusSpanDetail)
	}
	s.focus = runsFocus(next)
}

func (s *Runs) activateFocus(c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		if s.selRun == "" {
			return nil
		}
		s.loading = true
		s.detail = nil
		return fetchRunDetail(c, s.selRun)
	case focusWaterfall:
		s.focus = focusSpanDetail
	}
	return nil
}

func (s *Runs) moveDown(c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(c, +1)
	default:
		return s.cycleSpan(+1)
	}
}

func (s *Runs) moveUp(c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(c, -1)
	default:
		return s.cycleSpan(-1)
	}
}

func (s *Runs) cycleRun(c DataClient, delta int) tea.Cmd {
	if len(s.runs) == 0 {
		return nil
	}
	s.runList.SetItems(s.runs)
	s.runList.SetCursorByIdentity(s.selRun)
	if delta > 0 {
		s.runList.CursorDown()
	} else {
		s.runList.CursorUp()
	}
	run, _, ok := s.runList.Cursor()
	if !ok || run.TraceID == s.selRun {
		// Cursor didn't move — already at the boundary. No need to
		// re-fetch or rescroll.
		return nil
	}
	s.selRun = run.TraceID
	s.loading = true
	s.detail = nil
	return fetchRunDetail(c, s.selRun)
}

func (s *Runs) cycleSpan(delta int) tea.Cmd {
	if s.detail == nil || len(s.detail.Spans) == 0 {
		return nil
	}
	idx := 0
	for i, sp := range s.detail.Spans {
		if sp.ID == s.selSpan {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(s.detail.Spans) {
		idx = len(s.detail.Spans) - 1
	}
	s.selSpan = s.detail.Spans[idx].ID
	return nil
}

func (s *Runs) Breadcrumb() ([]string, string) {
	path := []string{"runs"}
	if s.selRun != "" {
		path = append(path, "run "+truncate(s.selRun, 8))
	}
	if cur := s.currentSpan(); cur != nil && s.focus == focusSpanDetail {
		path = append(path, "span: "+cur.Name)
	}
	right := ""
	if s.loaded {
		right = fmt.Sprintf("%d runs · last 1h", len(s.runs))
	}
	return path, right
}

func (s *Runs) Keybinds() []shell.Keybind {
	jkLabel := "span"
	if s.focus == focusRuns {
		jkLabel = "run"
	}
	return []shell.Keybind{
		shell.Bind("j/k", jkLabel),
		shell.Bind("h/l", "pane"),
		shell.Bind("↵", focusActionLabel(s.focus)),
		shell.Bind("i", "inspect raw"),
		shell.Bind("o", "open in viewer"),
		shell.Bind(":", "cmd"),
		shell.Bind("?", "help"),
		shell.Bind("q", "quit"),
	}
}

// focusTitle prefixes a teal `▸` accent + bold teal text to the pane title
// when that pane is focused, so the user can see which pane j/k will affect.
func focusTitle(title string, focused bool) string {
	if focused {
		return lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▸ ") +
			lipgloss.NewStyle().Foreground(shell.ColorTeal).Bold(true).Render(title)
	}
	return title
}

func focusActionLabel(f runsFocus) string {
	switch f {
	case focusRuns:
		return "load run"
	case focusWaterfall:
		return "span detail"
	default:
		return "open"
	}
}

func (s *Runs) Counts() map[string]int { return map[string]int{"runs": len(s.runs)} }

func (s *Runs) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading runs…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}

	// Layout proportions follow the design: list ~22%, waterfall ~50%,
	// detail ~28% (with two 1-col vertical separators between them).
	listW := size.Width * 22 / 100
	if listW < 28 {
		listW = 28
	}
	detailW := size.Width * 28 / 100
	if detailW < 32 {
		detailW = 32
	}
	if listW+detailW+2 >= size.Width {
		detailW = size.Width - listW - 2 - 40
		if detailW < 30 {
			detailW = 30
		}
	}
	waterfallW := size.Width - listW - detailW - 2
	if waterfallW < 30 {
		waterfallW = 30
	}

	list := s.renderList(listW, size.Height)
	waterfall := s.renderWaterfall(waterfallW, size.Height)
	detail := s.renderSpanDetail(detailW, size.Height)

	body := kit.ComposeColumns(
		kit.PadBlock(list, listW, size.Height),
		kit.PadBlock(waterfall, waterfallW, size.Height),
		kit.PadBlock(detail, detailW, size.Height),
	)
	return body
}

// --- left pane: run list ----------------------------------------------------

func (s *Runs) renderList(width, height int) string {
	right := shell.TextMuted.Render("sort: time ↓")
	header := shell.PaneHeader(width,
		focusTitle("Runs", s.focus == focusRuns),
		"Last 1h", right)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	if len(s.runs) == 0 {
		b.WriteString(" " + shell.TextMuted.Render("no runs yet"))
		b.WriteString("\n")
		for i := 1; i < bodyRows; i++ {
			b.WriteString(strings.Repeat(" ", width) + "\n")
		}
		return strings.TrimRight(b.String(), "\n")
	}

	s.runList.SetItems(s.runs)
	s.runList.SetHeight(bodyRows)
	s.runList.SetCursorByIdentity(s.selRun)
	rows := s.runList.Render(width, func(r api.QualityRunRecord, _ int, selected bool, rowW int) string {
		row1, row2 := s.renderRunRow(r, rowW, selected)
		return row1 + "\n" + row2
	})
	for _, row := range rows {
		b.WriteString(row)
		b.WriteString("\n")
	}
	for len(rows) < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		rows = append(rows, "")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Runs) renderRunRow(r api.QualityRunRecord, width int, selected bool) (string, string) {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	dot := kit.StatusDot(r.Status)

	idCol := shell.Text.Render(padString2(shortID(r.TraceID, 7), 7))
	targetCol := shell.TextDim.Render(truncate(r.TargetID, 12))
	ago := shell.TextMuted.Render(relTimeUnix(r.StartedAt))

	// Line 1: bar + dot + id + target + age (right).
	line1Core := fmt.Sprintf("%s %s %s  %s", bar, dot, idCol, targetCol)
	pad := width - lipgloss.Width(line1Core) - lipgloss.Width(ago) - 2
	if pad < 1 {
		pad = 1
	}
	line1 := line1Core + strings.Repeat(" ", pad) + ago + " "

	// Line 2: indented duration · tokens, with optional "N traces" tag for
	// flow / pipeline runs that fanned out into multiple child traces.
	lat := durStr(r.DurationMs)
	tok := formatTokensShort(r.TokenCount) + " tok"
	if r.TokenCount == 0 {
		tok = "— tok"
	}
	subParts := []string{lat, tok}
	if r.TraceCount > 1 {
		subParts = append(subParts, fmt.Sprintf("%d traces", r.TraceCount))
	}
	line2 := "    " + shell.TextMuted.Render(strings.Join(subParts, "  "))

	return padRow(line1, width), padRow(line2, width)
}

// --- center pane: trace waterfall ------------------------------------------

func (s *Runs) renderWaterfall(width, height int) string {
	if s.detail == nil {
		header := shell.PaneHeader(width, focusTitle("Trace", s.focus == focusWaterfall), "—", "")
		body := centerMsg(Size{Width: width, Height: height - 2}, "loading trace…")
		return header + "\n" + body
	}

	// Header — left: "Trace XXXX" (or "Run XXXX" when grouped) + sub
	// "{target} · {dur} · {N} spans · {tok}". Per CONTEXT.md the
	// canonical noun is "Run" — "Trace" is not a UI synonym. Multi-trace
	// runs surface their trace count in the subtitle, not the title.
	id := shortID(s.detail.Run.TraceID, 7)
	title := focusTitle("Run "+id, s.focus == focusWaterfall)
	tokStr := ""
	if s.detail.Run.TokenCount > 0 {
		tokStr = " · " + formatTokensShort(s.detail.Run.TokenCount) + " tok"
	}
	subParts := []string{
		s.detail.Run.TargetID,
		durStr(s.detail.Run.DurationMs),
		fmt.Sprintf("%d spans", len(s.detail.Spans)),
	}
	if s.detail.Run.TraceCount > 1 {
		subParts = append(subParts, fmt.Sprintf("%d traces", s.detail.Run.TraceCount))
	}
	sub := strings.Join(subParts, " · ") + tokStr
	headerChips := renderTraceChips(s.detail)
	header := shell.PaneHeader(width, title, sub, headerChips)
	hdrH := strings.Count(header, "\n") + 1

	footer := shell.PaneFooter(width, []shell.Keybind{
		shell.Bind("↵", "expand"),
		shell.Bind("i", "inspect raw"),
		shell.Bind("o", "open in viewer"),
		shell.Bind("e", "export"),
		// Note: `f flame chart` and `t timeline` are intentionally absent —
		// they were aspirational footer labels that never had handlers. Per
		// the KEYBINDS.md contract, footer/status hints must reflect what
		// the screen actually does. See plans/tui-v1-quality-workbench-implementation.md S7.
	})
	footerH := strings.Count(footer, "\n") + 1
	bodyRows := height - hdrH - footerH

	totalMs := 0.0
	if s.detail.Run.DurationMs != nil {
		totalMs = *s.detail.Run.DurationMs
	}

	// Column geometry: glyph(2) + space + op(10) + space + name(26) + space
	// + bar(?) + space + dur(7). Compute barCol once so the ruler aligns.
	// op widened from 6 → 10 to accommodate "pipeline" / "consensus" /
	// "retrieval" without truncation; name shrunk from 28 → 26 to keep
	// the bar column generous.
	const (
		glyphCol = 2
		opCol    = 10
		nameCol  = 26
		durCol   = 7
		gaps     = 4 // single-space separators between cols
	)
	barCol := width - glyphCol - opCol - nameCol - durCol - gaps - 2
	if barCol < 12 {
		barCol = 12
	}
	labelPrefix := glyphCol + 1 + opCol + 1 + nameCol + 1 // cols before the bar

	rows := kit.FromAPISpans(s.detail.Spans, s.detail.Trace.StartedAt, s.selSpan)
	wfLines := renderWaterfallSpans(rows, totalMs, width, labelPrefix, barCol)

	rulerLine := renderTimeRuler(totalMs, labelPrefix, barCol, width)

	var lines []string
	lines = append(lines, rulerLine)
	lines = append(lines, wfLines...)

	// Sparse-state polish: only fill the empty vertical space with the
	// trace summary block when the trace is essentially empty (≤ 2
	// spans). The design doesn't have this block for normal traces;
	// leaving it always-on cluttered the pane with redundant info.
	if len(wfLines) <= 2 {
		filler := s.renderTraceSummary(width, bodyRows-len(lines))
		if filler != "" {
			lines = append(lines, "")
			lines = append(lines, strings.Split(filler, "\n")...)
		}
	}

	if len(lines) > bodyRows {
		lines = lines[:bodyRows]
	}
	for len(lines) < bodyRows {
		lines = append(lines, strings.Repeat(" ", width))
	}

	return header + "\n" + strings.Join(lines, "\n") + "\n" + footer
}

// renderTraceSummary fills the rest of the waterfall pane when a trace has
// only a couple of spans. Surfaces input + output previews and a few
// counters so the pane reads as intentional rather than empty.
func (s *Runs) renderTraceSummary(width, height int) string {
	if s.detail == nil || height < 4 {
		return ""
	}
	var b strings.Builder
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")
	b.WriteString(" " + shell.SectionTag.Render("TRACE SUMMARY"))
	b.WriteString("\n")
	b.WriteString(kvRow("spans", fmt.Sprintf("%d", len(s.detail.Spans)), width))
	if s.detail.Run.DurationMs != nil {
		b.WriteString(kvRow("duration", formatSpanDuration(*s.detail.Run.DurationMs), width))
	}
	if s.detail.Run.TokenCount > 0 {
		b.WriteString(kvRow("tokens", commaInt(s.detail.Run.TokenCount), width))
	}
	if s.detail.Run.Model != "" {
		b.WriteString(kvRow("model", fmt.Sprintf("%s/%s", s.detail.Run.Provider, s.detail.Run.Model), width))
	}
	if preview := truncate(stringifyJSON(s.detail.Run.Input), width-4); preview != "" {
		b.WriteString("\n " + shell.SectionTag.Render("INPUT"))
		b.WriteString("\n")
		b.WriteString(boxedPre(preview, width-2))
		b.WriteString("\n")
	}
	if preview := truncate(stringifyJSON(s.detail.Run.Output), width-4); preview != "" {
		b.WriteString("\n " + shell.SectionTag.Render("OUTPUT"))
		b.WriteString("\n")
		b.WriteString(boxedPre(preview, width-2))
		b.WriteString("\n")
	}
	return b.String()
}

func stringifyJSON(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case map[string]any:
		if len(t) == 0 {
			return ""
		}
	}
	return jsonOrString(v)
}

// renderTraceChips builds the small chip cluster shown on the right of the
// waterfall pane header (e.g. RETRIEVAL-LOOP, INS-014).
func renderTraceChips(d *api.QualityRunDetailRecord) string {
	if d == nil {
		return ""
	}
	chips := []string{}
	// Linked insight tags: take the first insight from the first span that
	// has one, render as a rose chip; then list the insight IDs as dim.
	seen := map[string]bool{}
	for _, sp := range d.Spans {
		for _, id := range sp.LinkedInsightIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			chips = append(chips, kit.Chip(id, shell.ColorRose))
			if len(chips) >= 2 {
				break
			}
		}
		if len(chips) >= 2 {
			break
		}
	}
	if len(chips) == 0 {
		return ""
	}
	return strings.Join(chips, " ")
}

// renderTimeRuler renders the `0s 1s 2s … Ns` ruler row, using the same
// `labelPrefix` whitespace as the span rows so ticks align with the bar
// column underneath.
func renderTimeRuler(totalMs float64, labelPrefix, barCol, width int) string {
	if barCol <= 0 {
		return strings.Repeat(" ", width)
	}
	if totalMs <= 0 {
		// No measurable duration — render a placeholder ruler so the row
		// isn't a confusing blank line.
		prefix := strings.Repeat(" ", labelPrefix)
		track := strings.Repeat("·", barCol)
		row := prefix + shell.TextMuted.Render(track) + " " +
			shell.TextMuted.Render("0ms")
		if w := lipgloss.Width(row); w < width {
			row += strings.Repeat(" ", width-w)
		}
		return row
	}
	totalSec := totalMs / 1000.0
	// One label every ~5 cols matches the design (screenshot 3 shows
	// 1s ticks across a 14.2s trace ⇒ ~14 labels). The legacy value
	// (7) under-sampled and we got 5s steps where the design shows 1s.
	maxTicks := barCol / 5
	if maxTicks < 2 {
		maxTicks = 2
	}
	step := tickStep(totalSec, maxTicks)

	row := make([]rune, barCol)
	for i := range row {
		row[i] = ' '
	}
	// Track the right-edge of the last placed label so we never overwrite.
	lastWritten := -1
	for t := 0.0; t <= totalSec+step/2; t += step {
		pos := int((t / totalSec) * float64(barCol))
		if pos >= barCol {
			pos = barCol - 1
		}
		label := fmt.Sprintf("%gs", t)
		if pos <= lastWritten {
			continue
		}
		for i, r := range label {
			if pos+i >= barCol {
				break
			}
			row[pos+i] = r
		}
		lastWritten = pos + len(label)
	}
	endLabel := fmt.Sprintf("%.1fs", totalSec)
	prefix := strings.Repeat(" ", labelPrefix)
	rendered := prefix + shell.TextMuted.Render(string(row)) + " " + shell.TextDim.Render(endLabel)
	if w := lipgloss.Width(rendered); w < width {
		rendered += strings.Repeat(" ", width-w)
	}
	return rendered
}

// tickStep returns a tick interval (in seconds) suited to the trace
// duration and the visual budget. Prefers "nice" round numbers
// (1/2/5 × 10^k) and clamps so labels don't collide.
func tickStep(totalSec float64, maxTicks int) float64 {
	candidates := []float64{0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60}
	for _, s := range candidates {
		if totalSec/s <= float64(maxTicks) {
			return s
		}
	}
	// Very long trace — fall back to ~1/maxTicks of the duration rounded.
	return totalSec / float64(maxTicks)
}

// renderWaterfallSpans turns the API spans into renderable rows aligned with
// the time ruler. Each row: glyph + op chip + name + bar + duration.
//
// Indentation follows the V1 design: root span (depth 0) and its direct
// children (depth 1) share column 0; depth 2+ shift right by
// `(depth-1) * 2` spaces. The bar column stays at a fixed position
// (labelPrefix) so timing comparisons across depths remain meaningful —
// the name column shrinks for deeper rows to absorb the indent.
//
// Last-child sibling detection drives ├ vs └ glyphs: walking the parent
// chain in time order, the final child of each parent gets └.
func renderWaterfallSpans(rows []kit.WaterfallSpan, totalMs float64, width, labelPrefix, barCol int) []string {
	if totalMs <= 0 {
		totalMs = 1
	}
	const (
		opColW       = 10
		nameColW     = 26 // total cols for indent + glyph + " " + name
		indentPerLvl = 2
	)

	// Identify the last child per parent so we can pick └ vs ├.
	lastByParent := map[string]string{}
	for _, sp := range rows {
		lastByParent[sp.ParentID] = sp.ID
	}

	out := make([]string, 0, len(rows))
	for _, sp := range rows {
		primitive := sp.Primitive
		if primitive == "" {
			primitive = sp.Op
		}
		color := kit.PrimitiveColor(primitive)

		// Indent goes at the START of the line so the whole glyph→op→name
		// block shifts right with depth. Root + direct children at col 0;
		// depth 2+ pushed right by (depth-1) * 2 cols. The bar column
		// remains at a fixed position because the name budget shrinks by
		// the same amount.
		depthIndent := 0
		if sp.Indent > 1 {
			depthIndent = (sp.Indent - 1) * indentPerLvl
		}
		indentSpaces := strings.Repeat(" ", depthIndent)

		// Tree glyph: ◆ for root, └ for the last child of its parent, ├ otherwise.
		var treeGlyph string
		switch {
		case sp.Indent == 0:
			treeGlyph = "◆"
		case lastByParent[sp.ParentID] == sp.ID:
			treeGlyph = "└"
		default:
			treeGlyph = "├"
		}
		glyph := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(treeGlyph)

		op := padString2(primitiveLabel(sp), opColW)
		opStyled := lipgloss.NewStyle().Foreground(color).Render(op)

		// Name budget = (nameColW - depthIndent) total cols available
		// after the indent. Subtract 2 for the primitive glyph + space.
		nameWidth := nameColW - depthIndent
		if nameWidth < 10 {
			nameWidth = 10
		}
		// Design uses just one glyph per row — the tree connector
		// (`◆` for root, `├`/`└` for children). The legacy
		// `PrimitiveGlyph` prefix put a second glyph next to the name
		// (`✦`, `⚒`, `⇶`, etc.) which read as emoji-ish on most
		// terminals and didn't match the design.
		name := sp.Name
		if sp.Duplicate {
			name = name + "  · dup"
		}
		nameInner := truncate(name, nameWidth)
		nameStyled := lipgloss.NewStyle().Foreground(textColorFor(sp)).Render(padString2(nameInner, nameWidth))

		offsetFrac := sp.StartedMs / totalMs
		widthFrac := sp.DurationMs / totalMs
		bar := makeSpanBar(barCol, offsetFrac, widthFrac, color, sp.Selected)

		dur := padString2Right(formatSpanDuration(sp.DurationMs), 7)
		durStyled := shell.TextDim.Render(dur)

		left := " "
		if sp.Selected {
			left = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
		}

		// Row layout (always width-stable so bars stay aligned):
		//   <sel> <indent><glyph> <op> <name> <bar> <dur>
		// The indent eats into the name column, not the bar column.
		row := fmt.Sprintf("%s %s%s %s %s %s %s",
			left, indentSpaces, glyph, opStyled, nameStyled, bar, durStyled,
		)
		if w := lipgloss.Width(row); w < width {
			row += strings.Repeat(" ", width-w)
		}
		out = append(out, row)
		_ = labelPrefix
	}
	return out
}

// textColorFor picks the row text color: rose for duplicate spans
// (matches the design's "+ N more · dup" rendering), default text otherwise.
func textColorFor(sp kit.WaterfallSpan) color.Color {
	if sp.Duplicate {
		return shell.ColorRose
	}
	return shell.ColorText
}

// primitiveLabel produces the short label shown in the op-chip column
// (the second column of the waterfall row). For compositions we show
// the composition type (pipeline/parallel/consensus/swarm) instead of
// the generic "composition" word.
func primitiveLabel(sp kit.WaterfallSpan) string {
	switch sp.Primitive {
	case "pipeline", "parallel", "consensus", "swarm":
		return sp.Primitive
	case "flow.step":
		return "step"
	case "eval.flow":
		return "eval"
	case "retrieval.stage":
		return "stage"
	case "":
		return sp.Op
	default:
		return sp.Primitive
	}
}

func spanOpColor(op string) color.Color {
	switch op {
	case "agent":
		return shell.ColorTeal
	case "llm":
		return shell.ColorViolet
	case "tool":
		return shell.ColorAmber
	default:
		return shell.ColorTextDim
	}
}

// makeSpanBar renders the single-cell bar column for a span. Width-frac and
// offset-frac are clamped defensively (the API can emit pathological values
// for malformed traces).
func makeSpanBar(width int, offsetFrac, widthFrac float64, c color.Color, selected bool) string {
	if width <= 0 {
		return ""
	}
	if offsetFrac < 0 || offsetFrac != offsetFrac {
		offsetFrac = 0
	}
	if offsetFrac > 1 {
		offsetFrac = 1
	}
	if widthFrac < 0 || widthFrac != widthFrac {
		widthFrac = 0
	}
	if widthFrac > 1 {
		widthFrac = 1
	}

	offset := int(offsetFrac * float64(width))
	if offset < 0 {
		offset = 0
	}
	if offset >= width {
		offset = width - 1
	}
	bw := int(widthFrac * float64(width))
	if bw < 1 {
		bw = 1
	}
	if offset+bw > width {
		bw = width - offset
		if bw < 1 {
			bw = 1
		}
	}

	pre := strings.Repeat("·", offset)
	preStyled := lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(pre)

	// Selection is conveyed by the row's `▌` marker, not by tinting the
	// waterfall bar. The previous `Background(SelectedRowBG())` on a
	// selected span's bar painted a saturated dark-teal block around
	// the colored bar — read as a "glow" rather than a row highlight.
	barStyle := lipgloss.NewStyle().Foreground(c)
	bar := barStyle.Render(strings.Repeat("█", bw))

	post := ""
	if rem := width - offset - bw; rem > 0 {
		post = lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("·", rem))
	}
	return preStyled + bar + post
}

func formatSpanDuration(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.2fs", ms/1000)
	}
	if ms >= 1 {
		return fmt.Sprintf("%dms", int(ms))
	}
	return "—"
}

// --- right pane: span detail ------------------------------------------------

func (s *Runs) renderSpanDetail(width, height int) string {
	if s.detail == nil || len(s.detail.Spans) == 0 {
		header := shell.PaneHeader(width, "span: —", "", "")
		body := centerMsg(Size{Width: width, Height: height - 1}, "no span selected")
		return header + "\n" + body
	}
	span := s.currentSpan()
	if span == nil {
		span = &s.detail.Spans[0]
	}
	title := focusTitle("span: "+truncate(span.Name, width-15), s.focus == focusSpanDetail)
	header := shell.PaneHeader(width, title, formatSpanDuration(deref(span.DurationMs)), "")

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	// IDENTITY — exactly 4 rows per the design: span_id · parent · kind · op.
	// `primitive` is intentionally omitted — for agent/tool/llm spans it
	// duplicates `kind`/`op`, and surfacing it as a separate row crowded
	// the panel.
	b.WriteString(s.section("IDENTITY"))
	b.WriteString(kvRow("span_id", truncate(span.ID, 18), width))
	b.WriteString(kvRow("parent", parentLabel(span), width))
	b.WriteString(kvRow("kind", span.Kind, width))
	b.WriteString(kvRowColored("op", span.Op, spanOpColor(span.Op), width))
	b.WriteString("\n")

	// TIMING
	b.WriteString(s.section("TIMING"))
	b.WriteString(kvRow("start", formatSpanStart(span.StartedAt, s.detail.Trace.StartedAt), width))
	dur := formatSpanDuration(deref(span.DurationMs))
	b.WriteString(kvRowColored("duration", dur, durationColor(span.DurationMs, s.detail.Run.DurationMs), width))
	b.WriteString(kvRow("self", "—", width)) // self time not exposed by backend
	b.WriteString(s.childrenRow(span, width))
	b.WriteString("\n")

	// COST
	if span.TokenCount > 0 || span.Cost != nil {
		b.WriteString(s.section("COST"))
		if span.TokenCount > 0 {
			b.WriteString(kvRowColored("tokens", commaInt(span.TokenCount), tokenColor(span.TokenCount), width))
		}
		if span.Cost != nil {
			b.WriteString(kvRow("$", fmt.Sprintf("$%.3f", *span.Cost), width))
		}
		b.WriteString("\n")
	}

	// ERROR — normalized failure evidence from observability. Kept above
	// primitive details so execution failures are visible even when the
	// primitive payload is large or generic.
	if errPayload := renderSpanError(*span, width); errPayload != "" {
		b.WriteString(s.section("ERROR"))
		b.WriteString(errPayload)
		b.WriteString("\n")
	}

	// Primitive-specific details — curated kvRows per primitive (no
	// JSON dumps). Tool spans surface name/args-preview/result-
	// preview/error; generations surface model/tokens/finish reason;
	// retrieval surfaces query/hits/score; etc. Header reads as the
	// primitive's name (`TOOL`, `GENERATION`, `RETRIEVAL`, …) so the
	// user immediately sees what kind of span they're inspecting.
	if payload := renderPrimitivePayload(*span, width); payload != "" {
		b.WriteString(s.section(spanDetailHeader(span)))
		b.WriteString(payload)
		b.WriteString("\n")
	}

	// TIMINGS — only when the primitive carries replay-quality signals.
	if span.Timings != nil {
		b.WriteString(s.section("TIMINGS"))
		if span.Timings.TTFTMs != nil {
			b.WriteString(kvRow("ttft", fmt.Sprintf("%.0fms", *span.Timings.TTFTMs), width))
		}
		if span.Timings.TotalChunks != nil {
			b.WriteString(kvRow("chunks", fmt.Sprintf("%d", *span.Timings.TotalChunks), width))
		}
		if span.Timings.TokensPerSecond != nil {
			b.WriteString(kvRow("tok/s", fmt.Sprintf("%.0f", *span.Timings.TokensPerSecond), width))
		}
		if span.Timings.Retries > 0 {
			b.WriteString(kvRowColored("retries", fmt.Sprintf("%d", span.Timings.Retries), shell.ColorAmber, width))
		}
		b.WriteString("\n")
	}

	// ATTRIBUTES — always shown when populated. The design renders
	// these as the primary "what was this span configured with"
	// surface (agent.name, agent.iter.max, query.lang, retriever.k,
	// etc.) — they're more informative than a JSON payload dump.
	if len(span.Attributes) > 0 {
		b.WriteString(s.section("ATTRIBUTES"))
		b.WriteString(renderAttributes(span.Attributes, width))
		b.WriteString("\n")
	}

	// LINKED INSIGHTS — colored bullet + ID + (placeholder note).
	if len(span.LinkedInsightIDs) > 0 {
		b.WriteString(s.section("LINKED INSIGHTS"))
		for _, id := range span.LinkedInsightIDs {
			bullet := lipgloss.NewStyle().Foreground(shell.ColorRose).Render("●")
			b.WriteString(" " + bullet + "  ")
			b.WriteString(shell.Text.Render(padString2(id, 10)))
			b.WriteString("  ")
			b.WriteString(shell.TextMuted.Render("linked"))
			b.WriteString("\n")
		}
	}

	hdrH := strings.Count(header, "\n") + 1
	return kit.PadBlock(b.String(), width, height-hdrH+1)
}

func (s *Runs) section(label string) string {
	return " " + shell.SectionTag.Render(label) + "\n"
}

// spanDetailHeader picks the section title for the primitive-details
// block. Maps both legacy (`tool`) and detailed (`tool.call`) primitive
// strings to the same family name. Generic primitives fall back to
// `PAYLOAD` so the section still has a stable label.
func spanDetailHeader(span *api.QualityRunSpan) string {
	switch span.Primitive {
	case api.SpanPrimitiveTool, api.SpanPrimitiveToolCall, api.SpanPrimitiveToolApproval:
		return "TOOL"
	case api.SpanPrimitiveTrace, api.SpanPrimitiveGeneration,
		api.SpanPrimitiveGenerationCall, api.SpanPrimitiveGenerationStream:
		return "GENERATION"
	case api.SpanPrimitiveFlow, api.SpanPrimitiveFlowRun, api.SpanPrimitiveFlowStep,
		api.SpanPrimitiveEvalFlow:
		return "FLOW"
	case api.SpanPrimitiveEvalRun, api.SpanPrimitiveEvalCase:
		return "EVAL"
	case api.SpanPrimitivePipeline, api.SpanPrimitiveCompositionPipeline:
		return "PIPELINE"
	case api.SpanPrimitiveParallel, api.SpanPrimitiveCompositionParallel:
		return "PARALLEL"
	case api.SpanPrimitiveConsensus, api.SpanPrimitiveCompositionConsensus:
		return "CONSENSUS"
	case api.SpanPrimitiveSwarm, api.SpanPrimitiveCompositionSwarm:
		return "SWARM"
	case api.SpanPrimitiveCompositionBranch:
		return "BRANCH"
	case api.SpanPrimitiveCompositionJoin:
		return "JOIN"
	case api.SpanPrimitiveCompositionVote:
		return "VOTE"
	case api.SpanPrimitiveDelegate, api.SpanPrimitiveDelegateInvoke:
		return "DELEGATE"
	case api.SpanPrimitiveHandoff, api.SpanPrimitiveHandoffPrepare:
		return "HANDOFF"
	case api.SpanPrimitiveRetrieval, api.SpanPrimitiveRetrievalStage,
		api.SpanPrimitiveRetrievalQuery:
		return "RETRIEVAL"
	case api.SpanPrimitiveEmbed, api.SpanPrimitiveEmbeddingCall:
		return "EMBEDDING"
	case api.SpanPrimitiveJudge, api.SpanPrimitiveScoringJudge:
		return "JUDGE"
	case api.SpanPrimitiveCitationCheck:
		return "CITATION CHECK"
	case api.SpanPrimitiveMemory, api.SpanPrimitiveMemoryRead, api.SpanPrimitiveMemoryWrite:
		return "MEMORY"
	case api.SpanPrimitiveBlackboard:
		return "BLACKBOARD"
	case api.SpanPrimitiveCompact, api.SpanPrimitiveCompactionRun:
		return "COMPACTION"
	case api.SpanPrimitiveAgent, api.SpanPrimitiveAgentRun:
		return "AGENT"
	case api.SpanPrimitivePromptResolve:
		return "PROMPT"
	case api.SpanPrimitiveContextResolve, api.SpanPrimitiveContextPredicate,
		api.SpanPrimitiveContextCache:
		return "CONTEXT"
	case api.SpanPrimitivePlan, api.SpanPrimitivePlanOperation:
		return "PLAN"
	case api.SpanPrimitiveTask, api.SpanPrimitiveTaskOperation:
		return "TASK"
	case api.SpanPrimitiveCache, api.SpanPrimitiveCacheLookup:
		return "CACHE"
	}
	return "PAYLOAD"
}

func (s *Runs) childrenRow(span *api.QualityRunSpan, width int) string {
	children, dup := s.childrenStats(span.ID)
	if children == 0 {
		return kvRow("children", "—", width)
	}
	label := fmt.Sprintf("%d", children)
	if dup > 0 {
		label += fmt.Sprintf(" (%d dup)", dup)
		return kvRowColored("children", label, shell.ColorRose, width)
	}
	return kvRow("children", label, width)
}

func (s *Runs) childrenStats(parentID string) (count, dups int) {
	if s.detail == nil {
		return 0, 0
	}
	for _, sp := range s.detail.Spans {
		if sp.ParentID == parentID {
			count++
			if sp.Duplicate {
				dups++
			}
		}
	}
	return
}

// --- helpers ---------------------------------------------------------------

func (s *Runs) currentSpan() *api.QualityRunSpan {
	if s.detail == nil {
		return nil
	}
	for i, sp := range s.detail.Spans {
		if sp.ID == s.selSpan {
			return &s.detail.Spans[i]
		}
	}
	return nil
}

func parentLabel(span *api.QualityRunSpan) string {
	if span.ParentID == "" {
		return "— (root)"
	}
	return truncate(span.ParentID, 16)
}

func formatSpanStart(spanStart, traceStart int64) string {
	if spanStart == 0 {
		return "+0s"
	}
	delta := spanStart - traceStart
	if delta < 0 {
		delta = 0
	}
	if delta >= 1000 {
		return fmt.Sprintf("+%.2fs", float64(delta)/1000.0)
	}
	return fmt.Sprintf("+%dms", delta)
}

func durationColor(spanDur, traceDur *float64) color.Color {
	if spanDur == nil || traceDur == nil || *traceDur == 0 {
		return shell.ColorText
	}
	frac := *spanDur / *traceDur
	switch {
	case frac >= 0.6:
		return shell.ColorRose
	case frac >= 0.25:
		return shell.ColorAmber
	default:
		return shell.ColorText
	}
}

func tokenColor(n int) color.Color {
	switch {
	case n >= 10_000:
		return shell.ColorAmber
	case n >= 50_000:
		return shell.ColorRose
	default:
		return shell.ColorText
	}
}

func renderAttributes(attrs map[string]string, width int) string {
	// Sort keys for stable rendering.
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Determine key column width (cap at half the pane).
	keyW := 0
	for _, k := range keys {
		if len(k) > keyW {
			keyW = len(k)
		}
	}
	if keyW > width/2 {
		keyW = width / 2
	}

	var b strings.Builder
	for _, k := range keys {
		v := attrs[k]
		row := fmt.Sprintf(" %s  %s",
			shell.TextDim.Render(padString2(k+":", keyW+1)),
			shell.Text.Render(truncate(v, width-keyW-4)),
		)
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	return b.String()
}

func deref(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func commaInt(n int) string {
	s := fmt.Sprintf("%d", n)
	if n < 1000 {
		return s
	}
	// Insert thousands separators.
	out := make([]byte, 0, len(s)+len(s)/3)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, byte(c))
	}
	return string(out)
}

// kvRow is the standard `muted-key  value` row used in detail panes across
// screens. Defined here because Runs is the most invariant consumer; other
// screens import it via the package.
func kvRow(k, v string, width int) string {
	kCol := 14
	key := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(padString2(k, kCol))
	val := lipgloss.NewStyle().Foreground(shell.ColorText).Render(v)
	row := fmt.Sprintf(" %s %s", key, val)
	return padRow(row, width) + "\n"
}

// kvRowColored is kvRow with a colored value.
func kvRowColored(k, v string, c color.Color, width int) string {
	kCol := 14
	key := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(padString2(k, kCol))
	val := lipgloss.NewStyle().Foreground(c).Render(v)
	row := fmt.Sprintf(" %s %s", key, val)
	return padRow(row, width) + "\n"
}

// padString2 right-pads an ASCII string with spaces to a fixed width.
func padString2(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}

func padString2Right(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return strings.Repeat(" ", width-len(s)) + s
}

// --- fetch -------------------------------------------------------------------

type runsListLoadedMsg []api.QualityRunRecord
type runDetailLoadedMsg api.QualityRunDetailRecord

func fetchRunsList(c DataClient) tea.Cmd {
	return func() tea.Msg {
		observabilityRuns, err := c.ObservabilityRuns(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return runsListLoadedMsg(qualityRunsFromObservability(observabilityRuns))
	}
}

func fetchRunDetail(c DataClient, traceID string) tea.Cmd {
	return func() tea.Msg {
		detail, found, detailErr := c.ObservabilityRunDetail(context.Background(), traceID)
		if detailErr != nil {
			return dataErrMsg(detailErr.Error())
		}
		if !found {
			return dataErrMsg("run not found")
		}
		return runDetailLoadedMsg(qualityRunDetailFromObservabilityDetail(detail))
	}
}

func qualityRunDetailFromObservabilityDetail(detail api.ObservabilityRunDetail) api.QualityRunDetailRecord {
	run := qualityRunFromObservability(detail.Run)
	trace := api.QualityTraceRecord{
		TraceID:    detail.Run.RunID,
		StartedAt:  parseObservabilityTime(detail.Run.StartedAt),
		Model:      detail.Run.Model,
		Provider:   detail.Run.Provider,
		DurationMs: durationPointer(detail.Run.DurationMs),
		Status:     normalizeObservabilityStatus(detail.Run.Status),
	}
	spans := qualitySpansFromRunDetailNode(detail.Root)
	events := make([]api.CorrelatedEvent, 0)
	for _, span := range spans {
		if len(span.Data) == 0 {
			continue
		}
	}
	return api.QualityRunDetailRecord{
		Tag:       "QualityRunDetail",
		Run:       run,
		Trace:     trace,
		Events:    events,
		Spans:     spans,
		Narrative: []api.QualityRunNarrativeEvent{},
	}
}

func qualitySpansFromRunDetailNode(root api.ObservabilityRunDetailNode) []api.QualityRunSpan {
	var spans []api.QualityRunSpan
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		data, _ := json.Marshal(buildSpanDataPayload(node))
		attrs := map[string]string{
			"family":    node.Family,
			"primitive": node.Primitive,
			"run_id":    node.RunID,
			"trace_id":  node.TraceID,
		}
		addStringAttr(attrs, "prompt_id", node.PromptID)
		addStringAttr(attrs, "context_id", node.ContextID)
		addStringAttr(attrs, "agent_id", node.AgentID)
		addStringAttr(attrs, "tool_name", node.ToolName)
		addStringAttr(attrs, "flow_id", node.FlowID)
		addStringAttr(attrs, "step_id", node.StepID)
		addStringAttr(attrs, "memory_id", node.MemoryID)
		addStringAttr(attrs, "retriever_id", node.RetrieverID)
		spans = append(spans, api.QualityRunSpan{
			ID:         firstNonEmpty(node.SpanID, node.ID),
			ParentID:   strings.TrimPrefix(node.ParentID, "span:"),
			Kind:       node.Display.Kind,
			Op:         node.Primitive,
			Primitive:  qualityPrimitiveFromObservability(node.Family, node.Primitive),
			Name:       node.Display.Label,
			Status:     normalizeObservabilityStatus(node.Status),
			StartedAt:  parseObservabilityTime(node.Timing.StartedAt),
			EndedAt:    parseObservabilityTime(node.Timing.EndedAt),
			DurationMs: durationPointer(node.Timing.DurationMs),
			EventType:  node.Primitive,
			Attributes: attrs,
			Data:       data,
			Error:      node.Error,
			Inspection: node.Inspection,
		})
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return spans
}

// buildSpanDataPayload flattens the rich RunDetailNode into a map the
// per-primitive renderers in payload.go can consume directly.
//
// Background: the SpanSummary embedded in RunDetailNode carries typed
// columns (Model, Provider, ToolName, FlowID, StepID, RetrieverID,
// MemoryID, AgentID, PromptID, ContextID) AND a free-form Attributes
// JSON blob AND attached artifacts (tool.request, tool.response,
// retrieval.hits, handoff.payload, messages, output, …). The pre-fix
// projection threw the typed columns away — it only kept Attributes
// (and shoved the whole node under a `node` key). That's why no
// per-primitive renderer found its keys at runtime.
//
// The fix surfaces everything the renderers need at the top level of
// the Data map, then layers on extras from artifacts/metrics/raw
// attributes. We keep the `node`/`details`/`events`/`artifacts`/
// `relations`/`diagnostics` keys for the inspect-raw overlay.
func buildSpanDataPayload(node api.ObservabilityRunDetailNode) map[string]any {
	p := map[string]any{
		"node":        node,
		"details":     node.Details,
		"events":      node.Events,
		"artifacts":   node.Artifacts,
		"relations":   node.Relations,
		"diagnostics": node.Diagnostics,
	}
	// Typed columns from SpanSummary — only set when non-empty so the
	// `_, ok := p[...]` checks in renderers cleanly skip absent fields.
	setIfNonEmpty(p, "model", node.Model)
	setIfNonEmpty(p, "provider", node.Provider)
	setIfNonEmpty(p, "toolName", node.ToolName)
	setIfNonEmpty(p, "flowId", node.FlowID)
	setIfNonEmpty(p, "stepId", node.StepID)
	setIfNonEmpty(p, "retrieverId", node.RetrieverID)
	setIfNonEmpty(p, "memoryId", node.MemoryID)
	setIfNonEmpty(p, "agentId", node.AgentID)
	setIfNonEmpty(p, "promptId", node.PromptID)
	setIfNonEmpty(p, "contextId", node.ContextID)
	// Raw Attributes overlay — primitives like generation.call carry
	// finishReason, temperature, mode here. Merge LAST so typed
	// columns win when both are present, except attributes that don't
	// collide. Strategy: merge attributes first, then overwrite with
	// typed columns above. We do it in the opposite order, so:
	// 1. snapshot the typed values we just set,
	// 2. merge attrs (may overwrite),
	// 3. restore typed values.
	typed := make(map[string]any, 10)
	for _, k := range []string{"model", "provider", "toolName", "flowId", "stepId",
		"retrieverId", "memoryId", "agentId", "promptId", "contextId"} {
		if v, ok := p[k]; ok {
			typed[k] = v
		}
	}
	mergeRawObject(p, node.Attributes)
	for k, v := range typed {
		p[k] = v
	}
	// Metrics → expose at top level as `metrics` AND project the common
	// token fields into a `usage` sub-object so the generation renderer
	// (which expects usage.promptTokens/completionTokens) Just Works.
	if metrics := decodeRawObject(firstRawObject(node.MetricBuckets.Total, node.MetricBuckets.Own, node.Metrics)); len(metrics) > 0 {
		p["metrics"] = metrics
		usage := map[string]any{}
		if v, ok := metrics["inputTokens"]; ok {
			usage["promptTokens"] = v
		}
		if v, ok := metrics["outputTokens"]; ok {
			usage["completionTokens"] = v
		}
		if v, ok := metrics["totalTokens"]; ok {
			usage["totalTokens"] = v
		}
		if len(usage) > 0 {
			p["usage"] = usage
		}
		if v, ok := metrics["costUsd"]; ok {
			p["costUsd"] = v
		}
	}
	// Artifacts → project canonical previews into top-level keys so
	// renderers can show args / result / hits / messages / output /
	// handoff payload + sizes without the renderer needing to know
	// about artifact taxonomy.
	for _, art := range node.Artifacts {
		preview := decodeRawObject(art.Preview)
		switch art.Kind {
		case "tool.request", "tool.args":
			if args, ok := preview["args"]; ok {
				p["args"] = args
			}
			// preview may also carry toolName / toolCallId — surface
			// when the span column is empty.
			if _, has := p["toolName"]; !has {
				if v, ok := preview["toolName"]; ok {
					p["toolName"] = v
				}
			}
			if v, ok := preview["toolCallId"]; ok {
				p["toolCallId"] = v
			}
		case "tool.response", "tool.result":
			if r, ok := preview["result"]; ok {
				p["result"] = r
			} else if len(preview) > 0 {
				// Fall back to the whole preview as the result.
				p["result"] = preview
			}
			if art.SizeBytes > 0 {
				p["outputSize"] = art.SizeBytes
			}
		case "retrieval.hits":
			if hits, ok := preview["hits"]; ok {
				p["hits"] = hits
			}
		case "handoff.payload":
			if v, ok := preview["handoffId"]; ok {
				if _, has := p["handoffId"]; !has {
					p["handoffId"] = v
				}
			}
			if v, ok := preview["data"]; ok {
				p["payload"] = v
			}
			attrs := decodeRawObject(art.Attributes)
			if v, ok := attrs["inputSize"]; ok {
				p["inputSize"] = v
			}
			if v, ok := attrs["outputSize"]; ok {
				p["outputSize"] = v
			}
		case "messages":
			if msgs, ok := preview["messages"]; ok {
				p["input"] = msgs
			}
		case "output":
			// Generation answer artifact — surface as `output`. If the
			// preview is `{answer: "..."}` we unwrap so the rendered
			// row reads the answer directly.
			if ans, ok := preview["answer"]; ok {
				p["output"] = ans
			} else if len(preview) > 0 {
				p["output"] = preview
			}
		}
	}
	// _start is preserved on the wire for replay; strip from the
	// visible projection so it doesn't pollute the generic fallback.
	delete(p, "_start")
	return p
}

func setIfNonEmpty(m map[string]any, k, v string) {
	if v != "" {
		m[k] = v
	}
}

// decodeRawObject parses a json.RawMessage as a map[string]any, or
// returns nil when the input is empty/null/non-object.
func decodeRawObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// mergeRawObject decodes a json.RawMessage object and merges its keys
// into m (no-op when the message is empty/null/non-object). Used to
// overlay free-form span.Attributes onto the structured Data map.
func mergeRawObject(m map[string]any, raw json.RawMessage) {
	src := decodeRawObject(raw)
	for k, v := range src {
		m[k] = v
	}
}

// firstRawObject returns the first non-empty, non-null RawMessage in
// the given list. Used to prefer Total → Own → Metrics for the rolled
// up token counts.
func firstRawObject(candidates ...json.RawMessage) json.RawMessage {
	for _, c := range candidates {
		if len(c) > 0 && string(c) != "null" && string(c) != "{}" {
			return c
		}
	}
	return nil
}

func qualityRunsFromObservability(runs []api.ObservabilityRunSummary) []api.QualityRunRecord {
	out := make([]api.QualityRunRecord, 0, len(runs))
	for _, run := range runs {
		out = append(out, qualityRunFromObservability(run))
	}
	return out
}

func qualityRunFromObservability(run api.ObservabilityRunSummary) api.QualityRunRecord {
	metrics := observabilityMetrics(run.Metrics)
	cost := optionalFloatMetric(metrics, "costUsd")
	return api.QualityRunRecord{
		Tag:           "QualityRun",
		TraceID:       run.RunID,
		TargetID:      firstNonEmpty(run.Name, run.RootPrimitive, run.RunID),
		PromptID:      optionalString(run.PromptID),
		Status:        normalizeObservabilityStatus(run.Status),
		StartedAt:     parseObservabilityTime(run.StartedAt),
		DurationMs:    durationPointer(run.DurationMs),
		Model:         run.Model,
		Provider:      run.Provider,
		TokenCount:    intMetric(metrics, "totalTokens"),
		Cost:          cost,
		TraceCount:    maxInt(1, run.SpanCount),
		ToolCallCount: 0,
		FeedbackIDs:   []string{},
		ExperimentIDs: []string{},
	}
}

func observabilityMetrics(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var metrics map[string]any
	if err := json.Unmarshal(raw, &metrics); err != nil {
		return nil
	}
	return metrics
}

func intMetric(metrics map[string]any, key string) int {
	switch value := metrics[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func optionalFloatMetric(metrics map[string]any, key string) *float64 {
	switch value := metrics[key].(type) {
	case float64:
		return &value
	case int:
		f := float64(value)
		return &f
	default:
		return nil
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func addStringAttr(attrs map[string]string, key string, value string) {
	if value != "" {
		attrs[key] = value
	}
}

func qualityPrimitiveFromObservability(family, primitive string) string {
	switch family {
	case "composition":
		if suffix, ok := strings.CutPrefix(primitive, "composition."); ok {
			return suffix
		}
		return family
	case "generation":
		return api.SpanPrimitiveGeneration
	case "tool":
		return api.SpanPrimitiveTool
	case "agent":
		return api.SpanPrimitiveAgent
	case "flow":
		if primitive == "flow.step" {
			return api.SpanPrimitiveFlowStep
		}
		return api.SpanPrimitiveFlow
	case "retrieval":
		return api.SpanPrimitiveRetrieval
	case "embedding":
		return api.SpanPrimitiveEmbed
	case "memory":
		return api.SpanPrimitiveMemory
	case "handoff":
		return api.SpanPrimitiveHandoff
	case "delegate":
		return api.SpanPrimitiveDelegate
	case "scoring":
		return api.SpanPrimitiveJudge
	case "ingest":
		return api.SpanPrimitiveIngest
	case "corpus":
		return api.SpanPrimitiveCorpus
	case "skill":
		return api.SpanPrimitiveSkill
	case "security":
		return api.SpanPrimitiveSecurity
	case "cost":
		return api.SpanPrimitiveCost
	default:
		if family != "" {
			return family
		}
		return api.SpanPrimitiveOther
	}
}

func normalizeObservabilityStatus(status string) string {
	switch status {
	case "ok", "success":
		return "ok"
	case "error", "failed", "fail":
		return "fail"
	case "cancelled", "canceled":
		return "cancelled"
	default:
		if status == "" {
			return "unknown"
		}
		return status
	}
}

func parseObservabilityTime(value string) int64 {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func durationPointer(ms float64) *float64 {
	if ms <= 0 {
		return nil
	}
	return &ms
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// runExportedMsg is emitted on a successful `e` export. The screen can
// surface a toast referencing the saved path.
type runExportedMsg struct {
	runID string
	path  string
}

// runExportErrMsg is emitted when the export cmd fails (e.g. fs error).
type runExportErrMsg struct{ err string }

// exportRun returns a tea.Cmd that writes the focused run's detail
// record as pretty-printed JSON to ~/.crux/exports/run-{id}.json. No-op
// (returns nil) when nothing is focused.
func (s *Runs) exportRun() tea.Cmd {
	if s.detail == nil || s.selRun == "" {
		return nil
	}
	rec := *s.detail
	id := s.selRun
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		path := filepath.Join(dir, "run-"+truncate(id, 12)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		return runExportedMsg{runID: id, path: path}
	}
}
