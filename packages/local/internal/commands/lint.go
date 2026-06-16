package commands

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

var lintSeverityRank = map[string]int{
	"error":   0,
	"warning": 1,
	"info":    2,
}

// NewLintCmd creates the "crux lint" command for authored-system health findings.
func NewLintCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var profile string
	var includeSuppressed bool
	var failOn string

	cmd := &cobra.Command{
		Use:   "lint",
		Short: "Check authored Crux project health",
		Example: `  crux lint
  crux lint --profile strict
  crux lint --fail-on warning
  crux lint --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			var index api.IndexData
			if err := f.Client().GetJSON(cmd.Context(), "/api/index", &index); err != nil {
				return err
			}

			findings, err := selectLintFindings(index.LintFindings, lintSelectionOptions{
				profile:           profile,
				includeSuppressed: includeSuppressed,
			})
			if err != nil {
				return err
			}

			io := f.Streams()
			if jsonOutput {
				if err := output.JSON(findings); err != nil {
					return err
				}
			} else {
				printLintFindings(io, findings, profile, includeSuppressed)
			}

			failures, err := lintGateFailures(findings, failOn)
			if err != nil {
				return err
			}
			if len(failures) > 0 {
				if !jsonOutput {
					fmt.Fprintf(io.Out, "%s %d finding(s) matched --fail-on=%s\n", io.Sprint(output.Red, "gate failed:"), len(failures), failOn)
				}
				return domain.ExitError{Code: 1}
			}
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().StringVar(&profile, "profile", "recommended", "Lint profile: off, recommended, strict, experimental")
	cmd.Flags().BoolVar(&includeSuppressed, "include-suppressed", false, "Include source-comment suppressed findings")
	cmd.Flags().StringVar(&failOn, "fail-on", "", "Exit 1 when selected findings include severity: error, warning, or info")
	return cmd
}

type lintSelectionOptions struct {
	profile           string
	includeSuppressed bool
}

func selectLintFindings(findings []api.IndexLintFinding, opts lintSelectionOptions) ([]api.IndexLintFinding, error) {
	profile := opts.profile
	if profile == "" {
		profile = "recommended"
	}
	switch profile {
	case "off":
		return []api.IndexLintFinding{}, nil
	case "recommended", "strict", "experimental":
	default:
		return nil, fmt.Errorf("unknown lint profile %q (expected off, recommended, strict, or experimental)", profile)
	}

	selected := make([]api.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		if finding.Suppressed && !opts.includeSuppressed {
			continue
		}
		if len(finding.Profiles) > 0 && !containsString(finding.Profiles, profile) {
			continue
		}
		selected = append(selected, finding)
	}
	sortLintFindings(selected)
	return selected, nil
}

func sortLintFindings(findings []api.IndexLintFinding) {
	sort.SliceStable(findings, func(i, j int) bool {
		left, right := findings[i], findings[j]
		if rankSeverity(left.Severity) != rankSeverity(right.Severity) {
			return rankSeverity(left.Severity) < rankSeverity(right.Severity)
		}
		if left.Category != right.Category {
			return left.Category < right.Category
		}
		if left.RuleID != right.RuleID {
			return left.RuleID < right.RuleID
		}
		return lintFindingTarget(left) < lintFindingTarget(right)
	})
}

func rankSeverity(severity string) int {
	if rank, ok := lintSeverityRank[severity]; ok {
		return rank
	}
	return 99
}

func lintGateFailures(findings []api.IndexLintFinding, failOn string) ([]api.IndexLintFinding, error) {
	if failOn == "" {
		return nil, nil
	}
	threshold, ok := lintSeverityRank[failOn]
	if !ok {
		return nil, fmt.Errorf("unknown --fail-on severity %q (expected error, warning, or info)", failOn)
	}
	failures := make([]api.IndexLintFinding, 0)
	for _, finding := range findings {
		rank, ok := lintSeverityRank[finding.Severity]
		if !ok {
			continue
		}
		if rank <= threshold {
			failures = append(failures, finding)
		}
	}
	return failures, nil
}

// printLintFindings renders authored-system health findings under a branded
// header: the active profile, a severity tally, and one block per finding. Every
// styled span funnels through io.Sprint so `--no-color`/non-TTY output stays
// byte-clean; results go to io.Out (stdout).
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

	fmt.Fprintf(io.Out, "  %s %s %s\n", severity, io.Sprint(output.Bold, finding.Title), io.Sprint(output.Dim, finding.RuleID))
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
	if len(finding.Fixes) > 0 {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Fixes[0].Description)
	}
	if finding.DocsURL != "" {
		fmt.Fprintf(io.Out, "     %s %s\n", io.Sprint(output.Dim, "docs:"), finding.DocsURL)
	}
	fmt.Fprintln(io.Out)
}

func countLintSeverities(findings []api.IndexLintFinding) map[string]int {
	counts := map[string]int{}
	for _, finding := range findings {
		counts[finding.Severity]++
	}
	return counts
}

func renderLintSeverityCount(io *output.IO, severity string, count int) string {
	text := fmt.Sprintf("%d", count)
	return io.Sprint(lintSeverityStyle(severity), text)
}

func renderLintSeverity(io *output.IO, severity string) string {
	return io.Sprint(lintSeverityStyle(severity), severity)
}

// lintSeverityStyle maps a finding severity to its color: error→red,
// warning→yellow, info→blue, anything else→dim.
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}
