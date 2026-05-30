package components

import (
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/tui/shell"
	"github.com/charmbracelet/lipgloss"
)

// WaterfallSpan is the renderable form of one span row.
type WaterfallSpan struct {
	ID              string
	ParentID        string
	Op              string // "agent" | "llm" | "tool" | other
	Primitive       string // api.SpanPrimitive*
	CompositionType string // "pipeline" | "parallel" | "consensus" | "swarm" (when Primitive == composition family)
	Name            string
	Indent          int
	StartedMs       float64
	DurationMs      float64
	Duplicate       bool
	Selected        bool
}

// Waterfall renders a trace span timeline with op-colored bars + duration labels.
// `width` is the total available width; the bar column takes whatever is left
// after the fixed-width label columns. `totalMs` is the trace duration (right
// edge of the timeline). Span offsets are interpreted as relative ms within
// the trace and clamped to [0, totalMs] so malformed data can never blow up
// `strings.Repeat` with a huge count.
func Waterfall(spans []WaterfallSpan, totalMs float64, width int) string {
	if totalMs <= 0 {
		totalMs = 1
	}
	const (
		glyphCol = 2
		opCol    = 6
		nameCol  = 28
		durCol   = 7
	)
	barCol := width - glyphCol - opCol - nameCol - durCol - 5
	if barCol < 8 {
		barCol = 8
	}

	var b strings.Builder
	for _, s := range spans {
		var glyph string
		switch {
		case s.Indent == 0:
			glyph = "◆"
		case s.Duplicate:
			glyph = "└"
		default:
			glyph = "├"
		}
		glyphRendered := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(glyph)

		op := opStyle(s.Op).Render(padString(s.Op, opCol))
		name := padString(s.Name, nameCol)
		nameStyled := shell.Text.Render(name)
		if s.Duplicate {
			nameStyled = shell.Rose.Render(name)
		}

		dur := padString(formatDuration(s.DurationMs), durCol)
		durStyled := shell.TextDim.Render(dur)

		// Bar.
		offsetFrac := s.StartedMs / totalMs
		widthFrac := s.DurationMs / totalMs
		bar := makeBar(barCol, offsetFrac, widthFrac, opColor(s.Op), s.Selected)

		prefixIndent := strings.Repeat(" ", s.Indent*2)

		row := fmt.Sprintf("%s %s%s %s %s %s %s",
			selectionPrefix(s.Selected),
			prefixIndent,
			glyphRendered,
			op,
			nameStyled,
			bar,
			durStyled,
		)
		b.WriteString(padRowToWidth(row, width))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// FromAPISpans turns the API spans into renderable rows. Indentation is
// inferred from parent chain. `traceStartMs` is the trace's absolute
// `StartedAt` (same unit as each span's `StartedAt`); span offsets are
// derived as `span.StartedAt - traceStartMs`. If `traceStartMs` is 0 we fall
// back to the minimum across spans so the waterfall always starts at 0.
func FromAPISpans(apiSpans []api.QualityRunSpan, traceStartMs int64, selectedID string) []WaterfallSpan {
	idx := map[string]int{}
	for i, s := range apiSpans {
		idx[s.ID] = i
	}
	indent := func(s api.QualityRunSpan) int {
		depth := 0
		cur := s
		for cur.ParentID != "" {
			next, ok := idx[cur.ParentID]
			if !ok {
				break
			}
			cur = apiSpans[next]
			depth++
			if depth > 32 { // bumped from 10 for deep flow → sub-trace nesting
				break
			}
		}
		return depth
	}
	origin := traceStartMs
	if origin == 0 {
		for i, s := range apiSpans {
			if i == 0 || s.StartedAt < origin {
				origin = s.StartedAt
			}
		}
	}
	out := make([]WaterfallSpan, 0, len(apiSpans))
	for _, s := range apiSpans {
		dur := 0.0
		if s.DurationMs != nil {
			dur = *s.DurationMs
		}
		offset := float64(s.StartedAt - origin)
		if offset < 0 {
			offset = 0
		}
		out = append(out, WaterfallSpan{
			ID:              s.ID,
			ParentID:        s.ParentID,
			Op:              spanOp(s),
			Primitive:       s.Primitive,
			CompositionType: s.CompositionType,
			Name:            s.Name,
			Indent:          indent(s),
			StartedMs:       offset,
			DurationMs:      dur,
			Duplicate:       s.Duplicate,
			Selected:        s.ID == selectedID,
		})
	}
	return out
}

// PrimitiveColor returns the canonical color for a span primitive. The UI
// uses this for both the waterfall bar and the op-chip text. Mirrors the
// design's palette: agent=teal, llm=violet, tool=amber, plus distinct
// hues for compositions and flow boundaries.
func PrimitiveColor(primitive string) lipgloss.Color {
	switch primitive {
	case "trace", "generation", "agent":
		return shell.ColorTeal
	case "tool":
		return shell.ColorAmber
	case "flow", "flow.step", "eval.flow":
		return shell.ColorViolet
	case "pipeline", "parallel", "consensus", "swarm":
		return shell.ColorViolet
	case "delegate", "handoff":
		return shell.ColorTeal
	case "retrieval", "retrieval.stage", "embed":
		return shell.ColorAmber
	case "judge", "plan", "task":
		return shell.ColorGreen
	case "memory", "blackboard", "compact":
		return shell.ColorTextDim
	default:
		return shell.ColorTextDim
	}
}

// PrimitiveGlyph used to return a small Unicode marker per primitive
// (`✦` generation, `⚒` tool, `⇶` flow, `⌬` eval, `⇄` handoff, `⌕`
// retrieval, `⚖` judge, etc.) and was rendered before the span name in
// the waterfall column. The glyphs read as emoji-ish on most terminals
// and didn't match the design — screenshot 3 uses only the tree
// connector (`◆` for root, `├`/`└` for children) plus the op label.
// The function and its callers were removed; this stub is preserved so
// downstream callers (if any) get a no-op rather than a compile error.
func PrimitiveGlyph(primitive string) string { return "" }

func spanOp(s api.QualityRunSpan) string {
	if s.EventType != "" {
		return s.EventType
	}
	return s.Kind
}

func opColor(op string) lipgloss.Color {
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

func opStyle(op string) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(opColor(op))
}

func selectionPrefix(selected bool) string {
	if selected {
		return lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	return " "
}

func makeBar(width int, offsetFrac, widthFrac float64, color lipgloss.Color, selected bool) string {
	if width <= 0 {
		return ""
	}
	// Clamp to [0, 1] to defend against malformed offsets (e.g. absolute
	// timestamps slipping through, NaN, division-by-zero artifacts).
	if offsetFrac < 0 || offsetFrac != offsetFrac { // NaN check via self-compare
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
	pre := strings.Repeat(" ", offset)
	barChar := "█"
	// Selection in the waterfall is conveyed by the row-level `▌`
	// marker; no extra bg fill on the bar (was `ColorPanelAlt`, read
	// as a darker block around the colored bar).
	style := lipgloss.NewStyle().Foreground(color)
	_ = selected
	bar := style.Render(strings.Repeat(barChar, bw))
	post := ""
	if rem := width - offset - bw; rem > 0 {
		post = strings.Repeat(" ", rem)
	}
	return pre + bar + post
}

func padString(s string, width int) string {
	if len(s) >= width {
		if width <= 1 {
			return s[:width]
		}
		return s[:width-1] + "…"
	}
	return s + strings.Repeat(" ", width-len(s))
}

func padRowToWidth(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func formatDuration(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.2fs", ms/1000)
	}
	return fmt.Sprintf("%dms", int(ms))
}

// WaterfallRuler renders the time ruler shown above the waterfall in the
// design — `0s  1s  2s  …  Ns` ticks across the bar column with the trace's
// total duration on the right. The label columns to the left of the bar are
// reserved with whitespace so ticks align with the bars below.
func WaterfallRuler(totalMs float64, width int) string {
	if totalMs <= 0 || width <= 0 {
		return strings.Repeat(" ", width)
	}
	const labelCols = 2 + 1 + 6 + 1 + 28 + 1 // glyph + space + op + space + name + space
	barCol := width - labelCols - 7 - 1      // duration col (7) + selection col (1)
	if barCol < 8 {
		barCol = 8
	}

	// Decide tick interval so we end up with roughly 8–14 ticks visible.
	totalSec := totalMs / 1000.0
	step := 1.0
	switch {
	case totalSec > 30:
		step = 5
	case totalSec > 15:
		step = 2
	case totalSec > 8:
		step = 1
	case totalSec > 3:
		step = 0.5
	default:
		step = 0.2
	}

	ruler := make([]rune, barCol)
	for i := range ruler {
		ruler[i] = ' '
	}
	tickStyle := lipgloss.NewStyle().Foreground(shell.ColorTextMuted)
	endStyle := lipgloss.NewStyle().Foreground(shell.ColorTextDim)
	var marks []string
	for t := 0.0; t <= totalSec; t += step {
		pos := int((t / totalSec) * float64(barCol))
		if pos < 0 || pos >= barCol {
			continue
		}
		label := fmt.Sprintf("%gs", t)
		marks = append(marks, fmt.Sprintf("%d:%s", pos, label))
	}

	// Render label row above the bar column.
	labelRow := make([]rune, barCol)
	for i := range labelRow {
		labelRow[i] = ' '
	}
	for _, m := range marks {
		var pos int
		var label string
		fmt.Sscanf(m, "%d:%s", &pos, &label)
		for i, r := range label {
			if pos+i >= barCol {
				break
			}
			labelRow[pos+i] = r
		}
	}

	rulerStr := tickStyle.Render(string(labelRow))
	end := endStyle.Render(fmt.Sprintf("%.1fs", totalSec))
	prefix := strings.Repeat(" ", labelCols)
	rendered := prefix + rulerStr + "  " + end
	if w := lipgloss.Width(rendered); w < width {
		rendered += strings.Repeat(" ", width-w)
	}
	return rendered
}
