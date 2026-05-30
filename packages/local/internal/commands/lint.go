package commands

import (
	"fmt"
	"sort"
	"strings"

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
		RunE: func(cmd *cobra.Command, args []string) error {
			var catalog api.CatalogData
			if err := f.Client().GetJSON(cmd.Context(), "/api/catalog", &catalog); err != nil {
				return err
			}

			findings, err := selectLintFindings(catalog.LintFindings, lintSelectionOptions{
				profile:           profile,
				includeSuppressed: includeSuppressed,
			})
			if err != nil {
				return err
			}

			if jsonOutput {
				if err := output.JSON(findings); err != nil {
					return err
				}
			} else {
				printLintFindings(findings, profile, includeSuppressed)
			}

			failures, err := lintGateFailures(findings, failOn)
			if err != nil {
				return err
			}
			if len(failures) > 0 {
				if !jsonOutput {
					fmt.Printf("%s %d finding(s) matched --fail-on=%s\n", output.Red.Render("gate failed:"), len(failures), failOn)
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

func selectLintFindings(findings []api.CatalogLintFinding, opts lintSelectionOptions) ([]api.CatalogLintFinding, error) {
	profile := opts.profile
	if profile == "" {
		profile = "recommended"
	}
	switch profile {
	case "off":
		return []api.CatalogLintFinding{}, nil
	case "recommended", "strict", "experimental":
	default:
		return nil, fmt.Errorf("unknown lint profile %q (expected off, recommended, strict, or experimental)", profile)
	}

	selected := make([]api.CatalogLintFinding, 0, len(findings))
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

func sortLintFindings(findings []api.CatalogLintFinding) {
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

func lintGateFailures(findings []api.CatalogLintFinding, failOn string) ([]api.CatalogLintFinding, error) {
	if failOn == "" {
		return nil, nil
	}
	threshold, ok := lintSeverityRank[failOn]
	if !ok {
		return nil, fmt.Errorf("unknown --fail-on severity %q (expected error, warning, or info)", failOn)
	}
	failures := make([]api.CatalogLintFinding, 0)
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

func printLintFindings(findings []api.CatalogLintFinding, profile string, includeSuppressed bool) {
	if profile == "" {
		profile = "recommended"
	}
	fmt.Printf("%s\n\n", output.Bold.Render("Crux Lint"))
	fmt.Printf("  Profile: %s", output.Cyan.Render(profile))
	if includeSuppressed {
		fmt.Printf("  %s", output.Dim.Render("including suppressed"))
	}
	fmt.Println()

	if len(findings) == 0 {
		fmt.Println(output.Dim.Render("  No lint findings."))
		return
	}

	counts := countLintSeverities(findings)
	fmt.Printf("  Findings: %s error  %s warning  %s info\n\n",
		renderLintSeverityCount("error", counts["error"]),
		renderLintSeverityCount("warning", counts["warning"]),
		renderLintSeverityCount("info", counts["info"]),
	)

	for _, finding := range findings {
		printLintFinding(finding)
	}
}

func printLintFinding(finding api.CatalogLintFinding) {
	severity := renderLintSeverity(finding.Severity)
	target := lintFindingTarget(finding)
	source := formatLintSource(finding.Source)

	fmt.Printf("  %s %s %s\n", severity, output.Bold.Render(finding.Title), output.Dim.Render(finding.RuleID))
	if target != "" || source != "" {
		fmt.Printf("     %s", output.Cyan.Render(target))
		if source != "" {
			fmt.Printf("  %s", output.Dim.Render(source))
		}
		fmt.Println()
	}
	if finding.Message != "" {
		fmt.Printf("     %s %s\n", output.Dim.Render("what:"), finding.Message)
	}
	if finding.Rationale != "" {
		fmt.Printf("     %s %s\n", output.Dim.Render("why:"), finding.Rationale)
	}
	if len(finding.Fixes) > 0 {
		fmt.Printf("     %s %s\n", output.Dim.Render("fix:"), finding.Fixes[0].Description)
	}
	if finding.DocsURL != "" {
		fmt.Printf("     %s %s\n", output.Dim.Render("docs:"), finding.DocsURL)
	}
	fmt.Println()
}

func countLintSeverities(findings []api.CatalogLintFinding) map[string]int {
	counts := map[string]int{}
	for _, finding := range findings {
		counts[finding.Severity]++
	}
	return counts
}

func renderLintSeverityCount(severity string, count int) string {
	text := fmt.Sprintf("%d", count)
	switch severity {
	case "error":
		return output.Red.Render(text)
	case "warning":
		return output.Yellow.Render(text)
	case "info":
		return output.Blue.Render(text)
	default:
		return output.Dim.Render(text)
	}
}

func renderLintSeverity(severity string) string {
	switch severity {
	case "error":
		return output.Red.Render("error")
	case "warning":
		return output.Yellow.Render("warning")
	case "info":
		return output.Blue.Render("info")
	default:
		return output.Dim.Render(severity)
	}
}

func lintFindingTarget(finding api.CatalogLintFinding) string {
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
