package kit

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// Seg is one segment in a stacked bar.
type Seg struct {
	Frac float64
	Tone theme.Tone
}

// Hint is one key-label pair rendered by KeyHints.
type Hint struct {
	Key   string
	Label string
}

// DiffLine is one rendered line in a diff block.
type DiffLine struct {
	Kind string
	Text string
}

// VariantMetrics is one row in the experiment matrix component.
type VariantMetrics struct {
	Name     string
	Pass     float64
	Score    float64
	Tokens   int
	Latency  string
	Cost     string
	Delta    string
	Baseline bool
	Winner   bool
}

// ProgressBar renders a single-line progress bar.
func ProgressBar(frac float64, w int, tone theme.Tone, styles theme.Styles) string {
	if w <= 0 {
		return ""
	}
	frac = clamp01(frac)
	filled := int(frac * float64(w))
	if frac > 0 && filled == 0 {
		filled = 1
	}
	if filled > w {
		filled = w
	}
	return styles.ToneStyle(tone).Render(strings.Repeat("█", filled)) +
		styles.Muted.Render(strings.Repeat("░", w-filled))
}

// StackedBar renders proportional, tone-colored segments.
func StackedBar(segs []Seg, w int, styles theme.Styles) string {
	if w <= 0 {
		return ""
	}
	var out strings.Builder
	used := 0
	for i, seg := range segs {
		part := int(clamp01(seg.Frac) * float64(w))
		if i == len(segs)-1 {
			part = w - used
		}
		if part < 0 {
			part = 0
		}
		used += part
		out.WriteString(styles.ToneStyle(seg.Tone).Render(strings.Repeat("█", part)))
	}
	if used < w {
		out.WriteString(styles.Muted.Render(strings.Repeat("░", w-used)))
	}
	return fitLine(out.String(), w)
}

// KeyHints renders key help pairs without splitting a pair across truncation.
func KeyHints(pairs []Hint, w int, styles theme.Styles) string {
	parts := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		rendered := styles.Accent.Render(pair.Key) + " " + styles.Dim.Render(pair.Label)
		next := strings.Join(append(parts, rendered), " · ")
		if w > 0 && len(parts) > 0 && displayCells(next) > w {
			break
		}
		parts = append(parts, rendered)
	}
	return fitLine(strings.Join(parts, " · "), w)
}

// Badge renders a bracketed semantic label.
func Badge(text string, tone theme.Tone, styles theme.Styles) string {
	return styles.Badge(tone, text)
}

// Box renders a bounded titled box.
func Box(title string, body []string, r Rect, rounded bool, styles theme.Styles) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	border := boxChars(rounded)
	lines := make([]string, 0, r.H)
	titlePart := ""
	if title != "" && r.W > 4 {
		titlePart = " " + Truncate(title, r.W-4, "…") + " "
	}
	topFill := r.W - 2 - displayCells(titlePart)
	if topFill < 0 {
		topFill = 0
	}
	lines = append(lines, styles.Border.Render(border.tl+titlePart+strings.Repeat(border.h, topFill)+border.tr))
	for i := 0; i < r.H-2; i++ {
		content := ""
		if i < len(body) {
			content = body[i]
		}
		lines = append(lines, styles.Border.Render(border.v)+fitLine(content, r.W-2)+styles.Border.Render(border.v))
	}
	if r.H > 1 {
		lines = append(lines, styles.Border.Render(border.bl+strings.Repeat(border.h, max(0, r.W-2))+border.br))
	}
	return lines
}

// Chart renders a compact multi-row chart.
func Chart(vals []float64, r Rect, tone theme.Tone, styles theme.Styles) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	if len(vals) == 0 {
		return []string{fitLine(styles.Muted.Render("no data"), r.W)}
	}
	minV, maxV := vals[0], vals[0]
	for _, v := range vals {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	rendered := ASCIIChart(vals, minV, maxV, min(r.W, len(vals)), r.H, "%g", 0, false)
	lines := strings.Split(rendered, "\n")
	out := make([]string, 0, r.H)
	for len(out) < r.H && len(out) < len(lines) {
		out = append(out, fitLine(styles.ToneStyle(tone).Render(lines[len(out)]), r.W))
	}
	for len(out) < r.H {
		out = append(out, strings.Repeat(" ", r.W))
	}
	return out
}

// Matrix renders experiment variants and metrics.
func Matrix(rows []VariantMetrics, r Rect, sel int, styles theme.Styles) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	table := NewTable[VariantMetrics]([]Col[VariantMetrics]{
		{Title: "variant", C: Ratio(2, 5), Value: func(v VariantMetrics) string { return variantName(v) }},
		{Title: "pass", C: Ratio(1, 8), Align: AlignRight, Value: func(v VariantMetrics) string { return fmt.Sprintf("%.0f%%", v.Pass*100) }},
		{Title: "score", C: Ratio(1, 8), Align: AlignRight, Value: func(v VariantMetrics) string { return fmt.Sprintf("%.2f", v.Score) }},
		{Title: "tok", C: Ratio(1, 8), Align: AlignRight, Value: func(v VariantMetrics) string { return fmt.Sprintf("%d", v.Tokens) }},
		{Title: "lat", C: Ratio(1, 8), Align: AlignRight, Value: func(v VariantMetrics) string { return v.Latency }},
		{Title: "cost", C: Ratio(1, 8), Align: AlignRight, Value: func(v VariantMetrics) string { return v.Cost }},
		{Title: "Δpass", C: Fill(), Align: AlignRight, Value: func(v VariantMetrics) string { return v.Delta }},
	})
	table.SetItems(rows)
	table.SetHeight(r.H)
	lines := table.Render(r.W, styles)
	for len(lines) < r.H {
		lines = append(lines, strings.Repeat(" ", r.W))
	}
	if len(lines) > r.H {
		lines = lines[:r.H]
	}
	return lines
}

// DiffBlock renders bounded diff text.
func DiffBlock(lines []DiffLine, r Rect, styles theme.Styles) []string {
	out := make([]string, 0, r.H)
	for i := 0; i < len(lines) && len(out) < r.H; i++ {
		line := lines[i]
		style := styles.Dim
		prefix := " "
		switch line.Kind {
		case "-", "del", "delete":
			style, prefix = styles.Red, "-"
		case "+", "add":
			style, prefix = styles.Green, "+"
		}
		out = append(out, fitLine(style.Render(prefix+" "+line.Text), r.W))
	}
	for len(out) < r.H {
		out = append(out, strings.Repeat(" ", r.W))
	}
	return out
}

func variantName(v VariantMetrics) string {
	prefix := " "
	if v.Baseline {
		prefix = "◎"
	} else if v.Winner {
		prefix = "★"
	}
	return prefix + " " + v.Name
}

type boxDrawing struct {
	tl string
	tr string
	bl string
	br string
	h  string
	v  string
}

func boxChars(rounded bool) boxDrawing {
	if rounded {
		return boxDrawing{tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│"}
	}
	return boxDrawing{tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│"}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func displayCells(s string) int {
	return lipgloss.Width(s)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
