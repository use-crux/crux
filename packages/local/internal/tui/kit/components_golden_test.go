package kit

import (
	"strings"
	"testing"

	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestComponentGolden(t *testing.T) {
	styles := theme.NewStyles(theme.Resolve(colorprofile.TrueColor))
	lines := []string{
		"SPARK " + Sparkline([]float64{1, 3, 2, 5}, 8, theme.Resolve(colorprofile.TrueColor).Teal),
		"PROG  " + ProgressBar(0.6, 10, theme.ToneGreen, styles),
		"STACK " + StackedBar([]Seg{{Frac: 0.25, Tone: theme.ToneRed}, {Frac: 0.5, Tone: theme.ToneAmber}}, 12, styles),
		"BADGE " + styles.Badge(theme.ToneRed, "high") + " " + Badge("agent-loop", theme.ToneDim, styles),
		"DOT   " + StatusDot("failed") + " " + SeverityDot("high"),
		"HINTS " + KeyHints([]Hint{{"j/k", "move"}, {"↵", "open"}, {":", "cmd"}}, 32, styles),
	}
	lines = append(lines, Box("Detail", []string{"body", "overflow text that clips"}, Rect{W: 24, H: 4}, true, styles)...)
	lines = append(lines, Chart([]float64{88, 91, 94, 90}, Rect{W: 24, H: 4}, theme.ToneTeal, styles)...)
	lines = append(lines, Matrix([]VariantMetrics{
		{Name: "baseline", Pass: 0.96, Score: 0.8, Tokens: 4500, Delta: "0", Baseline: true},
		{Name: "dedupe", Pass: 0.97, Score: 0.82, Tokens: 4200, Delta: "+1", Winner: true},
	}, Rect{W: 48, H: 4}, 1, styles)...)
	lines = append(lines, DiffBlock([]DiffLine{
		{Kind: "-", Text: "maxIterations: 16"},
		{Kind: "+", Text: "maxIterations: 3"},
		{Kind: " ", Text: "dedupe: 0.92"},
	}, Rect{W: 32, H: 3}, styles)...)

	uitest.Golden(t, "kit-components", strings.Join(lines, "\n"))
}

func TestComponentsStayBounded(t *testing.T) {
	styles := theme.NewStyles(theme.Resolve(colorprofile.TrueColor))
	cases := [][]string{
		Box("Long title that should clip", []string{"Long body text that should clip"}, Rect{W: 12, H: 3}, true, styles),
		DiffBlock([]DiffLine{{Kind: "+", Text: strings.Repeat("x", 40)}}, Rect{W: 10, H: 2}, styles),
		Matrix([]VariantMetrics{{Name: strings.Repeat("v", 40)}}, Rect{W: 24, H: 3}, 0, styles),
	}
	for _, lines := range cases {
		for _, line := range lines {
			if got := displayCells(line); got > 24 {
				t.Fatalf("component overflowed: width=%d line=%q", got, line)
			}
		}
	}
}
