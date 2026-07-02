package kit

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
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
		glyphRendered := lipgloss.NewStyle().Foreground(adapterPalette.Mut).Render(glyph)

		op := opStyle(s.Op).Render(padString(s.Op, opCol))
		name := padString(s.Name, nameCol)
		nameStyled := adapterStyles.Regular.Render(name)
		if s.Duplicate {
			nameStyled = adapterStyles.Red.Render(name)
		}

		dur := padString(formatDuration(s.DurationMs), durCol)
		durStyled := adapterStyles.Dim.Render(dur)

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
func PrimitiveColor(primitive string) color.Color {
	switch primitive {
	case "trace", "generation", "agent":
		return adapterPalette.Teal
	case "tool":
		return adapterPalette.Amber
	case "flow", "flow.step", "eval.flow":
		return adapterPalette.Violet
	case "pipeline", "parallel", "consensus", "swarm":
		return adapterPalette.Violet
	case "delegate", "handoff":
		return adapterPalette.Teal
	case "retrieval", "retrieval.stage", "embed":
		return adapterPalette.Amber
	case "judge", "plan", "task":
		return adapterPalette.Green
	case "memory", "blackboard", "compact":
		return adapterPalette.Dim
	default:
		return adapterPalette.Dim
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
