package commands

import (
	"fmt"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// printLintFindings renders authored-system health findings under a branded
// header with the active profile, severity tally, and one block per finding.
func printLintFindings(io *output.IO, findings []api.IndexLintFinding, profile string, includeSuppressed bool) {
	if profile == "" {
		profile = "recommended"
	}
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "lint"))
	fmt.Fprintf(io.Out, "  Profile: %s", io.Sprint(output.Cyan, profile))
	if includeSuppressed {
		fmt.Fprintf(io.Out, "  %s", io.Sprint(output.Dim, "including suppressed"))
	}
	fmt.Fprintln(io.Out)
	if len(findings) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No lint findings."))
		return
	}
	counts := countLintSeverities(findings)
	fmt.Fprintf(io.Out, "  Findings: %s error  %s warning  %s info\n\n",
		renderLintSeverityCount(io, "error", counts["error"]),
		renderLintSeverityCount(io, "warning", counts["warning"]),
		renderLintSeverityCount(io, "info", counts["info"]),
	)
	for _, finding := range findings {
		printLintFinding(io, finding)
	}
}

func printLintFinding(io *output.IO, finding api.IndexLintFinding) {
	severity := renderLintSeverity(io, finding.Severity)
	target := lintFindingTarget(finding)
	source := formatLintSource(finding.Source)
	title := io.Sprint(output.Bold, finding.Title)
	state := ""
	if finding.Suppressed {
		title = io.Sprint(output.Dim, finding.Title)
		state = " " + io.Sprint(output.Dim, "suppressed")
	}
	fmt.Fprintf(io.Out, "  %s %s %s%s\n", severity, title, io.Sprint(output.Dim, finding.RuleID), state)
	if target != "" || source != "" {
		fmt.Fprintf(io.Out, "     %s", io.Sprint(output.Cyan, target))
		if source != "" {
			fmt.Fprintf(io.Out, "  %s", io.Sprint(output.Dim, source))
		}
		fmt.Fprintln(io.Out)
	}
	if finding.Message != "" {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "what:"), finding.Message)
	}
	if finding.Rationale != "" {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "why:"), finding.Rationale)
	}
	if finding.Suppressed && finding.SuppressedBy != nil {
		directive := formatLintSuppressionEvidence(finding.SuppressedBy)
		fmt.Fprintf(io.Out, "     %s %s", io.Sprint(output.Dim, "suppressed:"), directive)
		if finding.SuppressedBy.Reason != "" {
			fmt.Fprintf(io.Out, " — %s", finding.SuppressedBy.Reason)
		}
		fmt.Fprintln(io.Out)
	}
	if len(finding.Fixes) > 0 {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Fixes[0].Description)
	}
	if finding.DocsURL != "" {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "docs:"), finding.DocsURL)
	}
	fmt.Fprintln(io.Out)
}

func formatLintSuppressionEvidence(evidence *api.IndexLintSuppressedBy) string {
	if evidence == nil {
		return ""
	}
	source := formatLintSource(evidence.Source)
	if evidence.Scope == "" {
		return source
	}
	if source == "" {
		return evidence.Scope
	}
	return evidence.Scope + " at " + source
}

func countLintSeverities(findings []api.IndexLintFinding) map[string]int {
	counts := map[string]int{}
	for _, finding := range findings {
		counts[finding.Severity]++
	}
	return counts
}

func renderLintSeverityCount(io *output.IO, severity string, count int) string {
	return io.Sprint(lintSeverityStyle(severity), fmt.Sprintf("%d", count))
}

func renderLintSeverity(io *output.IO, severity string) string {
	return io.Sprint(lintSeverityStyle(severity), severity)
}

func lintSeverityStyle(severity string) lipgloss.Style {
	switch severity {
	case "error":
		return output.Red
	case "warning":
		return output.Yellow
	case "info":
		return output.Blue
	default:
		return output.Dim
	}
}

func lintFindingTarget(finding api.IndexLintFinding) string {
	if finding.PrimaryDefinitionID != "" {
		return finding.PrimaryDefinitionID
	}
	if len(finding.RelatedDefinitionIDs) > 0 {
		return finding.RelatedDefinitionIDs[0]
	}
	if len(finding.AffectedDefinitionIDs) > 0 {
		return finding.AffectedDefinitionIDs[0]
	}
	return ""
}

func formatLintSource(source *api.SourceLoc) string {
	if source == nil || source.File == "" {
		return ""
	}
	if source.Line > 0 {
		return fmt.Sprintf("%s:%d", source.File, source.Line)
	}
	return source.File
}
