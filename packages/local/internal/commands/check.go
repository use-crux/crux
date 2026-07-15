package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
)

type checkOptions struct {
	root              string
	configPath        string
	projectID         string
	profile           string
	includeSuppressed bool
	failOn            string
	json              bool
}

type checkJSONV1 struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Project       checkProject           `json:"project"`
	Indexing      checkIndexing          `json:"indexing"`
	Diagnostics   []api.IndexDiagnostic  `json:"diagnostics"`
	Findings      []api.IndexLintFinding `json:"findings"`
	Summary       checkSummary           `json:"summary"`
}

type checkProject struct {
	ID   string `json:"id,omitempty"`
	Root string `json:"root"`
}

type checkIndexing struct {
	Status   string `json:"status"`
	Static   string `json:"static"`
	Semantic string `json:"semantic"`
	Cache    string `json:"cache,omitempty"`
}

type checkSummary struct {
	Definitions int  `json:"definitions"`
	Relations   int  `json:"relations"`
	Diagnostics int  `json:"diagnostics"`
	Findings    int  `json:"findings"`
	Errors      int  `json:"errors"`
	Warnings    int  `json:"warnings"`
	Info        int  `json:"info"`
	GateFailed  bool `json:"gateFailed"`
}

// NewCheckCmd creates the daemon-free `crux check` CI command.
func NewCheckCmd(f *cli.Factory) *cobra.Command {
	opts := checkOptions{}
	cmd := &cobra.Command{
		Use:   "check",
		Short: "Compile and check authored Crux project health",
		Long:  "Compile the Project Index once without a running dev server, then report compiler diagnostics and authored-system findings.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCheck(cmd.Context(), f.Streams(), opts, runProjectIndexForCommand)
		},
	}
	cmd.Flags().StringVar(&opts.root, "root", ".", "Project root (default current directory)")
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Optional absolute or root-relative Crux config path")
	cmd.Flags().StringVar(&opts.projectID, "project-id", "", "Optional project identity for display and cache scoping")
	cmd.Flags().StringVar(&opts.profile, "profile", "recommended", "Lint profile: off, recommended, strict, experimental")
	cmd.Flags().BoolVar(&opts.includeSuppressed, "include-suppressed", false, "Include source-comment suppressed findings")
	cmd.Flags().StringVar(&opts.failOn, "fail-on", "error", "Gate severity: error, warning, info, or none")
	cmd.Flags().BoolVar(&opts.json, "json", false, "Output one deterministic JSON v1 value")
	return cmd
}

func runCheck(ctx context.Context, ioStreams *output.IO, opts checkOptions, run projectIndexRunFunc) error {
	result, err := run(ctx, oneshot.Options{Root: opts.root, ConfigPath: opts.configPath, ProjectID: opts.projectID})
	if err != nil {
		fmt.Fprintf(ioStreams.Err, "crux check: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	report, failures, err := buildCheckReport(result, opts)
	if err != nil {
		fmt.Fprintf(ioStreams.Err, "crux check: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	if opts.json {
		err = writeCheckJSON(ioStreams.Out, report)
	} else {
		printCheckReport(ioStreams, report, opts.profile)
	}
	if err != nil {
		fmt.Fprintf(ioStreams.Err, "crux check: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	if len(failures) > 0 {
		return domain.ExitError{Code: 1}
	}
	return nil
}

func buildCheckReport(result oneshot.Result, opts checkOptions) (checkJSONV1, []api.IndexLintFinding, error) {
	index, err := projectIndexAPI(result.Index)
	if err != nil {
		return checkJSONV1{}, nil, err
	}
	findings, err := selectLintFindings(index.LintFindings, lintSelectionOptions{
		profile: opts.profile, includeSuppressed: opts.includeSuppressed,
	})
	if err != nil {
		return checkJSONV1{}, nil, err
	}
	failures, err := lintGateFailures(findings, opts.failOn)
	if err != nil {
		return checkJSONV1{}, nil, err
	}
	diagnostics := append([]api.IndexDiagnostic{}, index.Diagnostics...)
	sortIndexDiagnostics(diagnostics)
	root := opts.root
	if index.Project != nil && index.Project.Root != "" {
		root = index.Project.Root
	}
	report := checkJSONV1{
		SchemaVersion: 1,
		Project:       checkProject{ID: opts.projectID, Root: root},
		Indexing: checkIndexing{
			Status: result.Execution.Status, Static: result.Execution.Static,
			Semantic: result.Execution.Semantic, Cache: result.Execution.Cache,
		},
		Diagnostics: diagnostics,
		Findings:    findings,
		Summary: checkSummary{
			Definitions: len(index.Definitions), Relations: len(index.Relations),
			Diagnostics: len(diagnostics), Findings: len(findings), GateFailed: len(failures) > 0,
		},
	}
	for _, severity := range append(checkDiagnosticSeverities(diagnostics), checkFindingSeverities(findings)...) {
		switch severity {
		case "error":
			report.Summary.Errors++
		case "warning":
			report.Summary.Warnings++
		case "info":
			report.Summary.Info++
		}
	}
	return report, failures, nil
}

func writeCheckJSON(writer io.Writer, report checkJSONV1) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func sortIndexDiagnostics(diagnostics []api.IndexDiagnostic) {
	sort.SliceStable(diagnostics, func(i, j int) bool {
		left, right := diagnostics[i], diagnostics[j]
		if rankSeverity(left.Severity) != rankSeverity(right.Severity) {
			return rankSeverity(left.Severity) < rankSeverity(right.Severity)
		}
		if left.Code != right.Code {
			return left.Code < right.Code
		}
		return left.ID < right.ID
	})
}

func checkDiagnosticSeverities(values []api.IndexDiagnostic) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.Severity)
	}
	return result
}

func checkFindingSeverities(values []api.IndexLintFinding) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.Severity)
	}
	return result
}
