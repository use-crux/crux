package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

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
	if width < 88 {
		headerChips = ""
	}
	header := shell.PaneHeader(width, title, sub, headerChips)
	hdrH := strings.Count(header, "\n") + 1

	footer := shell.PaneFooter(width, s.waterfallKeybinds())
	footerH := 0
	if footer != "" {
		footerH = strings.Count(footer, "\n") + 1
	}
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

	rows := kit.FromAPISpans(s.visibleSpans(), s.detail.Trace.StartedAt, s.selSpan)
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
func renderTraceChips(d *api.InspectRunDetailRecord) string {
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
