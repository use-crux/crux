package tui

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func startupDiagnosticsBinding() key.Binding {
	return key.NewBinding(key.WithKeys("!"), key.WithHelp("!", "startup details"))
}

func (w *Workbench) startupDiagnosticsAction() interaction.Action {
	return interaction.Action{
		ID:      "workspace.startup-details",
		Binding: startupDiagnosticsBinding(),
		Run: func() tea.Cmd {
			if w.startupDiagnostic == nil {
				return nil
			}
			count := len(w.startupDiagnostic.Children)
			if count == 0 {
				count = 1
			}
			w.inspect.OpenText(
				"Runtime setup",
				fmt.Sprintf("%d %s", count, kit.Pluralize(count, "issue")),
				renderStartupDiagnostics(*w.startupDiagnostic),
			)
			return nil
		},
	}
}

func renderStartupDiagnostics(diagnostic startup.Diagnostic) string {
	findings := diagnostic.Children
	if len(findings) == 0 {
		findings = []startup.Diagnostic{diagnostic}
	}
	sections := make([]string, 0, len(findings))
	for index, finding := range findings {
		lines := []string{fmt.Sprintf("Issue %d of %d · %s", index+1, len(findings), finding.Code)}
		if finding.Message != "" {
			lines = append(lines, finding.Message)
		}
		context := make([]string, 0, 4)
		if finding.Source != "" {
			context = append(context, "source "+finding.Source)
		}
		if finding.FeatureKind != "" && finding.FeatureID != "" {
			context = append(context, finding.FeatureKind+" "+finding.FeatureID)
		}
		if finding.Arm != "" {
			context = append(context, "arm "+finding.Arm)
		}
		if finding.Category != "" {
			context = append(context, finding.Category)
		}
		if len(context) > 0 {
			lines = append(lines, strings.Join(context, " · "))
		}
		if finding.Reason != "" {
			lines = append(lines, "Why: "+finding.Reason)
		}
		if finding.WhatStillWorks != "" {
			lines = append(lines, "What still works: "+finding.WhatStillWorks)
		}
		if finding.Remediation != "" {
			lines = append(lines, "Fix: "+finding.Remediation)
		}
		if finding.Docs != "" {
			lines = append(lines, "Docs: "+finding.Docs)
		}
		sections = append(sections, strings.Join(lines, "\n"))
	}
	return strings.Join(sections, "\n\n")
}
