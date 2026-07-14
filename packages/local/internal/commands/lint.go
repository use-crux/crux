package commands

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
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
	var root string
	var configPath string
	var projectID string
	var server bool

	cmd := &cobra.Command{
		Use:   "lint",
		Short: "Check authored Crux project health",
		Example: `  crux lint
  crux lint --profile strict
  crux lint --fail-on warning
  crux lint --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			var index api.IndexData
			if server {
				if err := f.Client().GetJSON(cmd.Context(), "/api/index", &index); err != nil {
					return err
				}
			} else {
				result, err := runProjectIndexForCommand(cmd.Context(), oneshot.Options{
					Root: root, ConfigPath: configPath, ProjectID: projectID,
				})
				if err != nil {
					fmt.Fprintf(f.Streams().Err, "crux lint: %v\n", err)
					return domain.ExitError{Code: 2}
				}
				index, err = projectIndexAPI(result.Index)
				if err != nil {
					fmt.Fprintf(f.Streams().Err, "crux lint: %v\n", err)
					return domain.ExitError{Code: 2}
				}
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
				encoder := json.NewEncoder(io.Out)
				encoder.SetIndent("", "  ")
				if err := encoder.Encode(findings); err != nil {
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
	cmd.Flags().StringVar(&root, "root", ".", "Project root (default current directory)")
	cmd.Flags().StringVar(&configPath, "config", "", "Optional absolute or root-relative Crux config path")
	cmd.Flags().StringVar(&projectID, "project-id", "", "Optional project identity for display and cache scoping")
	cmd.Flags().BoolVar(&server, "server", false, "Read findings from the running devtools server instead of indexing once")
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
	if failOn == "none" {
		return []api.IndexLintFinding{}, nil
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}
