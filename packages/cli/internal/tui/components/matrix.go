package components

import (
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/tui/shell"
	"github.com/charmbracelet/lipgloss"
)

// VariantMatrix renders the experiment variants × metrics table from the V1
// design. Highlights winner (★) and baseline (◎) variants and color-codes
// pass-rate deltas vs the baseline.
func VariantMatrix(variants []api.QualityExperimentVariant, width int) string {
	cols := []matrixCol{
		{label: "variant", width: 28, align: alignLeft},
		{label: "pass", width: 8, align: alignRight},
		{label: "score", width: 8, align: alignRight},
		{label: "tok", width: 8, align: alignRight},
		{label: "lat", width: 8, align: alignRight},
		{label: "cost", width: 10, align: alignRight},
		{label: "Δ", width: 8, align: alignRight},
	}

	var b strings.Builder
	b.WriteString(matrixHeader(cols))
	b.WriteString("\n")
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")

	for _, v := range variants {
		// Design screenshot 4 marks:
		//   winner   →  ★  teal
		//   baseline →  ●  teal (filled, not the open ◎ glyph)
		//   other    →  ·  muted
		marker := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render("·")
		switch {
		case v.IsWinner:
			marker = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("★")
		case v.IsBaseline:
			marker = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("●")
		}
		name := v.Label
		if name == "" {
			name = v.ID
		}
		if v.IsBaseline {
			name = name + " " + shell.TextMuted.Render("baseline")
		}

		passStyled := percentColor(v.PassRate, v.BaselineDeltaPassPts)
		scoreStr := optionalFloat(v.MeanScore, "%.2f")
		tokStr := optionalKilo(v.TokensAvg)
		latStr := optionalLatency(v.LatencyP95Ms)
		costStr := optionalDollar(v.CostTotal)
		deltaStr := deltaPts(v.BaselineDeltaPassPts, v.IsBaseline)

		row := fmt.Sprintf(" %s %s%s %s %s %s %s %s",
			marker,
			padOrTruncate(name, cols[0].width-2),
			"",
			rightAlign(passStyled, cols[1].width),
			rightAlign(scoreStr, cols[2].width),
			rightAlign(tokStr, cols[3].width),
			rightAlign(latStr, cols[4].width),
			rightAlign(costStr, cols[5].width),
		)
		row += " " + rightAlign(deltaStr, cols[6].width)
		b.WriteString(row)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

type matrixCol struct {
	label string
	width int
	align int
}

const (
	alignLeft  = 0
	alignRight = 1
)

func matrixHeader(cols []matrixCol) string {
	var parts []string
	for _, c := range cols {
		txt := strings.ToUpper(c.label)
		if c.align == alignRight {
			parts = append(parts, rightAlign(shell.SectionTag.Render(txt), c.width))
		} else {
			parts = append(parts, padOrTruncate(shell.SectionTag.Render(txt), c.width))
		}
	}
	return "   " + strings.Join(parts, " ")
}

func percentColor(p *float64, delta *float64) string {
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	style := lipgloss.NewStyle().Foreground(shell.ColorText)
	if delta != nil {
		if *delta > 0 {
			style = lipgloss.NewStyle().Foreground(shell.ColorGreen)
		} else if *delta < 0 {
			style = lipgloss.NewStyle().Foreground(shell.ColorRose)
		}
	}
	return style.Render(fmt.Sprintf("%.0f%%", *p*100))
}

func optionalFloat(p *float64, fmtStr string) string {
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	return shell.TextDim.Render(fmt.Sprintf(fmtStr, *p))
}

func optionalKilo(p *float64) string {
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	if *p >= 1000 {
		return shell.TextDim.Render(fmt.Sprintf("%.1fk", *p/1000))
	}
	return shell.TextDim.Render(fmt.Sprintf("%.0f", *p))
}

func optionalLatency(p *float64) string {
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	if *p >= 1000 {
		return shell.TextDim.Render(fmt.Sprintf("%.1fs", *p/1000))
	}
	return shell.TextDim.Render(fmt.Sprintf("%.0fms", *p))
}

func optionalDollar(p *float64) string {
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	return shell.TextDim.Render(fmt.Sprintf("$%.2f", *p))
}

func deltaPts(p *float64, isBaseline bool) string {
	if isBaseline {
		return shell.TextMuted.Render("—")
	}
	if p == nil {
		return shell.TextMuted.Render("—")
	}
	switch {
	case *p > 0:
		return shell.Green.Render(fmt.Sprintf("+%.1f pts", *p))
	case *p < 0:
		return shell.Rose.Render(fmt.Sprintf("%.1f pts", *p))
	default:
		return shell.TextMuted.Render("0 pts")
	}
}

func rightAlign(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return strings.Repeat(" ", width-w) + s
}

func padOrTruncate(s string, width int) string {
	w := lipgloss.Width(s)
	if w == width {
		return s
	}
	if w < width {
		return s + strings.Repeat(" ", width-w)
	}
	return lipgloss.NewStyle().MaxWidth(width).Render(s)
}

func horizontalRuleDim(width int) string {
	return lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", width))
}
