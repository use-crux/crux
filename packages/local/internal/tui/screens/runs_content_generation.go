package screens

import (
	"fmt"
	"image/color"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func renderGenerationDepth(node *api.ObservabilityRunDetailNode, width int) string {
	if node == nil || node.Family != "generation" {
		return ""
	}
	var b strings.Builder
	if request := node.Request; request != nil {
		if requestHasComposition(request) {
			b.WriteString(diagnosisSection("REQUEST"))
			b.WriteString(renderContributions(request.Contributions, width))
			if request.Budget != nil {
				b.WriteString(renderBudget(*request.Budget, width))
			}
			b.WriteString("\n")
		}
		if request.UserPrompt != nil && len(request.UserPrompt.Segments) > 0 {
			b.WriteString(diagnosisSection("PROMPT · AUTHORED VS INTERPOLATED"))
			for _, segment := range request.UserPrompt.Segments {
				kind := "A"
				label := "authored"
				color := shell.ColorTextDim
				provenance := ""
				if segment.Dynamic {
					kind = "D"
					label = "dynamic"
					provenance = segment.Source
					color = shell.ColorTeal
				}
				text := strings.TrimSpace(sanitizeRunsInline(segment.Text))
				if text == "" {
					text = "↵"
				}
				value := text
				if provenance != "" {
					value = provenance + " · " + value
				}
				b.WriteString(kvRowColored("["+kind+"] "+label, truncateRunsInline(value, previewMax(width)), color, width))
			}
			b.WriteString("\n")
		}
	}
	if report := node.DecisionReport; report != nil && (len(report.Decisions) > 0 || report.Turn.Readout != "") {
		b.WriteString(diagnosisSection("DECISIONS"))
		if report.Turn.Readout != "" {
			b.WriteString(kvRow("readout", report.Turn.Readout, width))
		}
		for _, decision := range report.Decisions[:min(12, len(report.Decisions))] {
			subject := firstNonEmpty(decision.Subject.Name, decision.Subject.Label, decision.Subject.ID, decision.Subject.Kind)
			value := strings.TrimSpace(strings.Join([]string{decision.Outcome, decision.Reason.Text}, " · "))
			b.WriteString(kvRow(firstNonEmpty(subject, decision.Kind), value, width))
		}
		if remaining := len(report.Decisions) - min(12, len(report.Decisions)); remaining > 0 {
			b.WriteString(kvRow("more", fmt.Sprintf("+%d decisions", remaining), width))
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func requestHasComposition(request *observability.RunDetailRequest) bool {
	return len(request.Contributions) > 0 || request.Budget != nil
}

func renderContributions(contributions []observability.RunDetailRequestContribution, width int) string {
	var b strings.Builder
	for _, contribution := range contributions {
		glyph, color := contributionGlyph(contribution)
		label := glyph + " " + firstNonEmpty(contribution.InjectableKind, contribution.Kind, "context")
		parts := []string{contribution.SourceID, firstNonEmpty(contribution.State, contributionDisposition(contribution))}
		if contribution.Tokens != nil {
			parts = append(parts, fmt.Sprintf("%.0f tok", *contribution.Tokens))
		}
		if contribution.Reason != "" {
			parts = append(parts, contribution.Reason)
		}
		b.WriteString(kvRowColored(label, strings.Trim(strings.Join(parts, " · "), " ·"), color, width))
	}
	return b.String()
}

func contributionGlyph(contribution observability.RunDetailRequestContribution) (string, color.Color) {
	state := strings.ToLower(contribution.State)
	switch {
	case strings.Contains(state, "drop"):
		return "×", shell.ColorRose
	case strings.Contains(state, "disable"):
		return "○", shell.ColorTextMuted
	case contribution.Included:
		return "●", shell.ColorGreen
	default:
		return "◇", shell.ColorAmber
	}
}

func contributionDisposition(contribution observability.RunDetailRequestContribution) string {
	if contribution.Included {
		return "included"
	}
	return "considered"
}

func renderBudget(budget observability.RunDetailRequestBudget, width int) string {
	if budget.UsedTokens == nil && budget.TotalTokens == nil && budget.DroppedCount == 0 {
		return ""
	}
	used, total := 0.0, 0.0
	if budget.UsedTokens != nil {
		used = *budget.UsedTokens
	}
	if budget.TotalTokens != nil {
		total = *budget.TotalTokens
	}
	label := ""
	if total > 0 {
		label = fmt.Sprintf("%.0f/%.0f tok", used, total)
		barWidth := max(8, min(24, width-18))
		remaining := total - used
		if remaining < 0 {
			remaining = 0
		}
		label = stackedBar(barWidth, []float64{used, remaining}, []rune{'█', '·'}) + "  " + label
	} else if used > 0 {
		label = fmt.Sprintf("%.0f tok used", used)
	}
	if budget.DroppedCount > 0 {
		label = strings.TrimSpace(label + fmt.Sprintf(" · dropped %d", budget.DroppedCount))
	}
	return kvRow("budget", label, width)
}
