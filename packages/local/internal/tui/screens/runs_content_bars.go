package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func renderSpanSplitBars(node *api.ObservabilityRunDetailNode, width int) string {
	if node == nil {
		return ""
	}
	content := projectSpanSplits(*node)
	var b strings.Builder
	if total := content.SelfMs + content.ChildrenMs + content.DetailsMs; total > 0 {
		barWidth := max(8, min(24, width-18))
		bar := stackedBar(barWidth, []float64{content.SelfMs, content.ChildrenMs, content.DetailsMs}, []rune{'█', '▒', '░'})
		legend := splitLegend([]splitLegendItem{
			{"self", formatSpanDuration(content.SelfMs), content.SelfMs},
			{"children", formatSpanDuration(content.ChildrenMs), content.ChildrenMs},
			{"details", formatSpanDuration(content.DetailsMs), content.DetailsMs},
		})
		b.WriteString(kvRow("time", bar+"  "+legend, width))
	}
	if total := content.Input + content.Cache + content.Output; total > 0 {
		barWidth := max(8, min(24, width-18))
		bar := stackedBar(barWidth, []float64{content.Input, content.Cache, content.Output}, []rune{'█', '▒', '░'})
		legend := splitLegend([]splitLegendItem{
			{"in", formatMetricNumber(content.Input), content.Input},
			{"cache", formatMetricNumber(content.Cache), content.Cache},
			{"out", formatMetricNumber(content.Output), content.Output},
		})
		b.WriteString(kvRow("tokens", bar+"  "+legend, width))
	}
	return b.String()
}

type splitLegendItem struct {
	label, value string
	amount       float64
}

func splitLegend(items []splitLegendItem) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if item.amount > 0 {
			parts = append(parts, item.label+" "+item.value)
		}
	}
	return strings.Join(parts, " · ")
}

func stackedBar(width int, values []float64, glyphs []rune) string {
	total := 0.0
	for _, value := range values {
		total += value
	}
	if width <= 0 || total <= 0 {
		return ""
	}
	cells := make([]rune, 0, width)
	remaining := width
	for index, value := range values {
		count := 0
		if value > 0 {
			count = int(float64(width) * value / total)
			if count == 0 {
				count = 1
			}
		}
		if index == len(values)-1 || count > remaining {
			count = remaining
		}
		for range count {
			cells = append(cells, glyphs[index])
		}
		remaining -= count
	}
	for remaining > 0 {
		cells = append(cells, '·')
		remaining--
	}
	return shell.TextDim.Render(string(cells))
}

func formatMetricNumber(value float64) string {
	if value >= 1000 {
		return formatTokensShort(int(value))
	}
	return fmt.Sprintf("%.0f", value)
}
