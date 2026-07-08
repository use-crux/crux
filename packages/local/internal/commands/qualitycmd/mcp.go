package qualitycmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type qualityMCPListInput struct {
	Config string `json:"config,omitempty" jsonschema:"Path to an optional crux.config.ts policy file"`
	Cwd    string `json:"cwd,omitempty" jsonschema:"Working directory for project discovery"`
}

type qualityMCPShowInput struct {
	ExperimentID string `json:"experimentId" jsonschema:"Experiment id to read"`
	Dir          string `json:"dir,omitempty" jsonschema:"Quality persistence root"`
}

type qualityMCPRunInput struct {
	Config         string   `json:"config,omitempty" jsonschema:"Path to an optional crux.config.ts policy file"`
	Cwd            string   `json:"cwd,omitempty" jsonschema:"Working directory for project discovery"`
	IDs            []string `json:"ids,omitempty" jsonschema:"Evaluation ids to run"`
	Cases          []string `json:"cases,omitempty" jsonschema:"Case id/name glob filters"`
	Variants       []string `json:"variants,omitempty" jsonschema:"Variant names to run"`
	Failed         string   `json:"failed,omitempty" jsonschema:"Experiment id, or latest, whose failed cells should be rerun"`
	Sample         int      `json:"sample,omitempty" jsonschema:"Deterministic sample size; requires seed"`
	Seed           string   `json:"seed,omitempty" jsonschema:"Seed for deterministic sampling"`
	MaxCostUSD     float64  `json:"maxCostUsd,omitempty" jsonschema:"Stop scheduling new cells after this many USD"`
	ChangedSince   string   `json:"changedSince,omitempty" jsonschema:"Git ref used to select changed evaluations"`
	Trials         int      `json:"trials,omitempty" jsonschema:"Trial override"`
	Replay         string   `json:"replay,omitempty" jsonschema:"Replay mode: live, record-new, replay-strict, refresh"`
	Rescore        bool     `json:"rescore,omitempty" jsonschema:"Reuse cached outputs and rerun scorers/expects only"`
	Experiment     string   `json:"experiment,omitempty" jsonschema:"Grouping label stored on experiment records"`
	MaxConcurrency int      `json:"maxConcurrency,omitempty" jsonschema:"Maximum parallel cells"`
}

type qualityMCPDiffInput struct {
	A      string `json:"a" jsonschema:"First experiment id or record path"`
	B      string `json:"b" jsonschema:"Second experiment id or record path"`
	Config string `json:"config,omitempty" jsonschema:"Path to an optional crux.config.ts policy file"`
	Cwd    string `json:"cwd,omitempty" jsonschema:"Working directory for project discovery"`
	Dir    string `json:"dir,omitempty" jsonschema:"Quality persistence root"`
}

type qualityMCPCellEvidenceInput struct {
	ExperimentID string `json:"experimentId" jsonschema:"Experiment id to inspect"`
	CaseID       string `json:"caseId" jsonschema:"Case id for the selected cell"`
	VariantName  string `json:"variant" jsonschema:"Variant name for the selected cell"`
	Trial        int    `json:"trial" jsonschema:"Trial index for the selected cell"`
	Dir          string `json:"dir,omitempty" jsonschema:"Quality persistence root"`
}

type qualityMCPJudgeReportInput struct {
	EvaluationID string `json:"evaluationId" jsonschema:"Evaluation id to report"`
	Dir          string `json:"dir,omitempty" jsonschema:"Quality persistence root"`
}

type qualityMCPLabelInput struct {
	ExperimentID string `json:"experimentId" jsonschema:"Experiment id to label"`
	CaseID       string `json:"caseId" jsonschema:"Case id for the selected cell"`
	VariantName  string `json:"variant,omitempty" jsonschema:"Variant name for the selected cell"`
	Trial        int    `json:"trial,omitempty" jsonschema:"Trial index for the selected cell"`
	Verdict      string `json:"verdict" jsonschema:"Human verdict: pass or fail"`
	ScoreName    string `json:"score,omitempty" jsonschema:"Optional judge score name this label calibrates"`
	Note         string `json:"note,omitempty" jsonschema:"Optional human note"`
	Dir          string `json:"dir,omitempty" jsonschema:"Quality persistence root"`
}

// NewQualityMCPCmd creates `crux quality mcp`.
func NewQualityMCPCmd(_ *cli.Factory) *cobra.Command {
	cmd := &cobra.Command{
		Use:          "mcp",
		Short:        "Serve Quality tools over MCP stdio",
		Example:      "  crux quality mcp",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityMCP(cmd.Context())
		},
	}
	return cmd
}

func runQualityMCP(ctx context.Context) error {
	return newQualityMCPServer().Run(ctx, &mcp.StdioTransport{})
}

func newQualityMCPServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "crux-quality", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_list", Description: "List discovered Crux Quality evaluations as JSON."}, qualityMCPList)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_show", Description: "Read one saved Crux Quality experiment record as JSON."}, qualityMCPShow)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_run", Description: "Run Quality evaluations and return the compact run summary."}, qualityMCPRun)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_diff", Description: "Compare two saved Quality experiment records."}, qualityMCPDiff)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_cell_evidence", Description: "Read agent evidence for one experiment cell."}, qualityMCPCellEvidence)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_judge_report", Description: "Compare judge scores with human labels for an evaluation."}, qualityMCPJudgeReport)
	mcp.AddTool(server, &mcp.Tool{Name: "quality_label", Description: "Record a human pass/fail label for one experiment cell."}, qualityMCPLabel)
	return server
}

func qualityMCPList(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPListInput) (*mcp.CallToolResult, any, error) {
	opts := &qualityRunOpts{configPath: input.Config, cwd: input.Cwd}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, []string{"--collect-only"}, "")
	if err != nil {
		return nil, nil, err
	}
	go filterStderr(stderr)
	result := consumeQualityCollectStream(stdout, cmd.Wait)
	if result.err != nil {
		return nil, nil, errors.New(result.err.Message)
	}
	if result.exitCode != 0 {
		return nil, nil, fmt.Errorf("quality list exited %d", result.exitCode)
	}
	return jsonToolResult(result.manifests)
}

func qualityMCPShow(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPShowInput) (*mcp.CallToolResult, any, error) {
	dir := input.Dir
	if dir == "" {
		dir = filepath.Join(projectroot.Dir(), ".crux", "quality")
	}
	path := filepath.Join(dir, "experiments", input.ExperimentID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, nil, err
	}
	return jsonToolResult(decoded)
}

func qualityMCPRun(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPRunInput) (*mcp.CallToolResult, any, error) {
	opts := &qualityRunOpts{
		configPath:     input.Config,
		cwd:            input.Cwd,
		ids:            input.IDs,
		cases:          input.Cases,
		failed:         input.Failed,
		sample:         input.Sample,
		seed:           input.Seed,
		maxCost:        input.MaxCostUSD,
		changedSince:   input.ChangedSince,
		variants:       input.Variants,
		trials:         input.Trials,
		replay:         input.Replay,
		rescore:        input.Rescore,
		experiment:     input.Experiment,
		maxConcurrency: input.MaxConcurrency,
		ci:             true,
		quiet:          true,
	}
	if err := validateQualityRunOpts(opts); err != nil {
		return nil, nil, err
	}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, nil, "")
	if err != nil {
		return nil, nil, err
	}
	go filterStderr(stderr)
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{CI: true})
	reporter := newQualityReporter(opts, streams, 0)
	result := consumeQualityRunnerStream(stdout, cmd.Wait, reporter, nil)
	summary := buildQualityRunSummary(reporter, result.exitCode, result.err)
	return jsonToolResult(summary)
}

func qualityMCPDiff(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPDiffInput) (*mcp.CallToolResult, any, error) {
	if input.A == "" || input.B == "" {
		return nil, nil, fmt.Errorf("a and b are required")
	}
	dir := qualityDiffReadDir(qualityDiffOpts{cwd: input.Cwd, dir: input.Dir})
	opts := &qualityRunOpts{configPath: input.Config, cwd: input.Cwd}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, []string{
		"--diff-a", resolveQualityDiffRecordPath(dir, input.A),
		"--diff-b", resolveQualityDiffRecordPath(dir, input.B),
	}, "")
	if err != nil {
		return nil, nil, err
	}
	go filterStderr(stderr)
	result := consumeQualityDiffStream(stdout, cmd.Wait, nil)
	if result.err != nil {
		return nil, nil, result.err
	}
	if result.exitCode != 0 {
		return nil, nil, fmt.Errorf("quality diff exited %d", result.exitCode)
	}
	var decoded any
	if err := json.Unmarshal(result.diff, &decoded); err != nil {
		return nil, nil, err
	}
	return jsonToolResult(decoded)
}

func qualityMCPCellEvidence(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPCellEvidenceInput) (*mcp.CallToolResult, any, error) {
	if input.ExperimentID == "" {
		return nil, nil, fmt.Errorf("experimentId is required")
	}
	if input.CaseID == "" {
		return nil, nil, fmt.Errorf("caseId is required")
	}
	if input.VariantName == "" {
		return nil, nil, fmt.Errorf("variant is required")
	}
	if input.Trial < 0 {
		return nil, nil, fmt.Errorf("trial must be non-negative")
	}
	evidence, found, err := newQualityReadClient(input.Dir).CellEvidence(ctx, qualityCellEvidenceQuery(input))
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, fmt.Errorf("cell evidence for experiment %s not found", input.ExperimentID)
	}
	return jsonToolResult(evidence)
}

func qualityMCPJudgeReport(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPJudgeReportInput) (*mcp.CallToolResult, any, error) {
	if input.EvaluationID == "" {
		return nil, nil, fmt.Errorf("evaluationId is required")
	}
	report, found, err := quality.NewService(store.NewStore(), qualityReadDir(input.Dir)).JudgeReportAPI(ctx, input.EvaluationID)
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, fmt.Errorf("evaluation %s not found", input.EvaluationID)
	}
	return jsonToolResult(report)
}

func qualityMCPLabel(ctx context.Context, req *mcp.CallToolRequest, input qualityMCPLabelInput) (*mcp.CallToolResult, any, error) {
	if input.ExperimentID == "" {
		return nil, nil, fmt.Errorf("experimentId is required")
	}
	var out bytes.Buffer
	opts := qualityLabelOpts{
		dir:         input.Dir,
		caseID:      input.CaseID,
		variantName: nonEmptyString(input.VariantName, "default"),
		trial:       input.Trial,
		verdict:     input.Verdict,
		scoreName:   input.ScoreName,
		note:        input.Note,
	}
	if err := runQualityLabel(ctx, &out, input.ExperimentID, opts); err != nil {
		return nil, nil, err
	}
	return jsonToolResult(map[string]any{"message": out.String()})
}

func qualityCellEvidenceQuery(input qualityMCPCellEvidenceInput) api.QualityCellEvidenceQuery {
	return api.QualityCellEvidenceQuery{
		ExperimentID: input.ExperimentID,
		CaseID:       input.CaseID,
		VariantName:  input.VariantName,
		Trial:        input.Trial,
	}
}

func jsonToolResult(value any) (*mcp.CallToolResult, any, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, value, nil
}
