package commands

import (
	"context"
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

type lintOptions struct {
	root              string
	configPath        string
	projectID         string
	profile           string
	includeSuppressed bool
	failOn            string
	json              bool
	server            bool
}

// NewLintCmd creates the "crux lint" command for authored-system health findings.
func NewLintCmd(f *cli.Factory) *cobra.Command {
	opts := lintOptions{}

	cmd := &cobra.Command{
		Use:   "lint",
		Short: "Check authored Crux project health",
		Example: `  crux lint
  crux lint --profile strict
  crux lint --fail-on warning
  crux lint --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if opts.server {
				var index api.IndexData
				if err := f.Client().GetJSON(cmd.Context(), "/api/index", &index); err != nil {
					return err
				}
				return writeLintResult(f.Streams(), index, opts)
			}
			return runLint(cmd.Context(), f.Streams(), opts, runProjectIndexForCommand)
		},
	}

	cmd.Flags().BoolVar(&opts.json, "json", false, "Output as JSON")
	cmd.Flags().StringVar(&opts.profile, "profile", "recommended", "Lint profile: off, recommended, strict, experimental")
	cmd.Flags().BoolVar(&opts.includeSuppressed, "include-suppressed", false, "Include source-comment suppressed findings")
	cmd.Flags().StringVar(&opts.failOn, "fail-on", "", "Exit 1 when selected findings include severity: error, warning, or info")
	cmd.Flags().StringVar(&opts.root, "root", ".", "Project root (default current directory)")
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Optional absolute or root-relative Crux config path")
	cmd.Flags().StringVar(&opts.projectID, "project-id", "", "Optional project identity for display and cache scoping")
	cmd.Flags().BoolVar(&opts.server, "server", false, "Read findings from the running devtools server instead of indexing once")
	return cmd
}

func runLint(ctx context.Context, io *output.IO, opts lintOptions, run projectIndexRunFunc) error {
	result, err := run(ctx, oneshot.Options{Root: opts.root, ConfigPath: opts.configPath, ProjectID: opts.projectID})
	if err != nil {
		fmt.Fprintf(io.Err, "crux lint: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	index, err := projectIndexAPI(result.Index)
	if err != nil {
		fmt.Fprintf(io.Err, "crux lint: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	return writeLintResult(io, index, opts)
}

func writeLintResult(io *output.IO, index api.IndexData, opts lintOptions) error {
	findings, err := selectLintFindings(index.LintFindings, lintSelectionOptions{
		profile: opts.profile, includeSuppressed: opts.includeSuppressed,
	})
	if err != nil {
		return err
	}
	if opts.json {
		if err := io.WriteJSON(findings); err != nil {
			return err
		}
	} else {
		printLintFindings(io, findings, opts.profile, opts.includeSuppressed)
	}
	failures, err := lintGateFailures(findings, opts.failOn)
	if err != nil {
		return err
	}
	if len(failures) == 0 {
		return nil
	}
	if !opts.json {
		fmt.Fprintf(io.Out, "%s %d finding(s) matched --fail-on=%s\n", io.Sprint(output.Red, "gate failed:"), len(failures), opts.failOn)
	}
	return domain.ExitError{Code: 1}
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
