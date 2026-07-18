package screens

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

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
