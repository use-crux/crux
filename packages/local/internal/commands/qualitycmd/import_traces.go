package qualitycmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

type qualityImportTracesOpts struct {
	definition   string
	status       string
	since        string
	limit        int
	out          string
	withExpected bool
}

type qualityImportTraceRow struct {
	Name     string                `json:"name,omitempty"`
	Input    any                   `json:"input"`
	Expected any                   `json:"expected,omitempty"`
	Tags     []string              `json:"tags"`
	Metadata qualityImportMetadata `json:"metadata"`
}

type qualityImportMetadata struct {
	Provenance qualityImportProvenance `json:"provenance"`
}

type qualityImportProvenance struct {
	TraceID    string `json:"traceId"`
	ObservedAt string `json:"observedAt"`
	Source     string `json:"source"`
}

type qualityImportSkip struct {
	TraceID string
	Reason  string
}

// NewQualityImportTracesCmd creates `crux quality import-traces`.
func NewQualityImportTracesCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityImportTracesOpts{limit: 20, since: "7d"}
	cmd := &cobra.Command{
		Use:          "import-traces --definition <id>",
		Short:        "Import local trace inputs into a Quality dataset",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		Example:      "  crux quality import-traces --definition prompt:support.answer --out evals/datasets/support.jsonl",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityImportTraces(cmd.Context(), f, cmd.OutOrStdout(), *opts)
		},
	}
	cmd.Flags().StringVar(&opts.definition, "definition", "", "Definition id to sample traces for")
	cmd.Flags().StringVar(&opts.status, "status", "", "Filter by trace status: ok or error")
	cmd.Flags().StringVar(&opts.since, "since", "7d", "Import traces observed since this window, such as 7d or 12h")
	cmd.Flags().IntVar(&opts.limit, "limit", 20, "Maximum traces to import")
	cmd.Flags().StringVar(&opts.out, "out", "", "Dataset JSONL path (default: evals/datasets/<definition>.jsonl)")
	cmd.Flags().BoolVar(&opts.withExpected, "with-expected", false, "Copy current output to expected; review before trusting")
	return cmd
}

func runQualityImportTraces(ctx context.Context, f *cli.Factory, out io.Writer, opts qualityImportTracesOpts) error {
	if opts.definition == "" {
		return fmt.Errorf("--definition is required")
	}
	if opts.limit <= 0 {
		return fmt.Errorf("--limit must be positive")
	}
	runs, err := f.Client().ObservabilityRuns(ctx)
	if err != nil {
		return err
	}
	runs = selectQualityImportRuns(runs, opts)
	details := make([]api.ObservabilityRunDetail, 0, len(runs))
	for _, run := range runs {
		detail, found, err := f.Client().ObservabilityRunDetail(ctx, run.RunID)
		if err != nil {
			return err
		}
		if found {
			details = append(details, detail)
		}
	}
	rows, skipped := qualityImportRowsFromDetails(details, opts.withExpected)
	path := opts.out
	if path == "" {
		path = filepath.Join("evals", "datasets", safeQualityInitEvalID(opts.definition)+".jsonl")
	}
	if err := writeQualityImportRows(path, rows); err != nil {
		return err
	}
	for _, skip := range skipped {
		fmt.Fprintf(out, "skipped %s: %s\n", skip.TraceID, skip.Reason)
	}
	fmt.Fprintf(out, "Imported %d cases to %s\n", len(rows), path)
	fmt.Fprintf(out, "Use: dataset('%s', { input: z.object({ /* ... */ }) })\n", filepath.ToSlash(path))
	return nil
}

func selectQualityImportRuns(runs []api.ObservabilityRunSummary, opts qualityImportTracesOpts) []api.ObservabilityRunSummary {
	cutoff := qualityImportSinceCutoff(opts.since)
	selected := make([]api.ObservabilityRunSummary, 0, len(runs))
	for _, run := range runs {
		if !qualityImportDefinitionMatches(opts.definition, run.PromptID) {
			continue
		}
		if opts.status != "" && normalizeQualityImportStatus(run.Status) != opts.status {
			continue
		}
		if cutoff != nil {
			startedAt, err := time.Parse(time.RFC3339Nano, run.StartedAt)
			if err == nil && startedAt.Before(*cutoff) {
				continue
			}
		}
		selected = append(selected, run)
		if len(selected) >= opts.limit {
			break
		}
	}
	return selected
}

func qualityImportRowsFromDetails(details []api.ObservabilityRunDetail, withExpected bool) ([]qualityImportTraceRow, []qualityImportSkip) {
	rows := make([]qualityImportTraceRow, 0, len(details))
	skipped := []qualityImportSkip{}
	for _, detail := range details {
		input, hasInput := qualityImportArtifact(detail.Root, "input", "messages", "prompt")
		output, hasOutput := qualityImportArtifact(detail.Root, "output")
		if !hasInput {
			skipped = append(skipped, qualityImportSkip{TraceID: detail.Run.RunID, Reason: "no input artifact"})
			continue
		}
		if withExpected && !hasOutput {
			skipped = append(skipped, qualityImportSkip{TraceID: detail.Run.RunID, Reason: "no output artifact for --with-expected"})
			continue
		}
		row := qualityImportTraceRow{
			Name:  firstNonEmptyQualityImportString(detail.Run.Name, detail.Run.RunID),
			Input: input,
			Tags:  []string{"trace-import"},
			Metadata: qualityImportMetadata{Provenance: qualityImportProvenance{
				TraceID:    firstNonEmptyQualityImportString(detail.Run.TraceID, detail.Run.RunID),
				ObservedAt: detail.Run.StartedAt,
				Source:     "trace-import",
			}},
		}
		if withExpected {
			row.Expected = output
		}
		rows = append(rows, row)
	}
	return rows, skipped
}

func qualityImportDefinitionMatches(definition string, promptID string) bool {
	if definition == "" || promptID == "" {
		return false
	}
	if definition == promptID {
		return true
	}
	if strings.HasPrefix(definition, "prompt:") && strings.TrimPrefix(definition, "prompt:") == promptID {
		return true
	}
	if strings.HasPrefix(promptID, "prompt:") && strings.TrimPrefix(promptID, "prompt:") == definition {
		return true
	}
	return false
}

func (row qualityImportTraceRow) jsonLine() (string, error) {
	data, err := json.Marshal(row)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func writeQualityImportRows(path string, rows []qualityImportTraceRow) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		line, err := row.jsonLine()
		if err != nil {
			return err
		}
		lines = append(lines, line)
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

func qualityImportArtifact(root api.ObservabilityRunDetailNode, kinds ...string) (any, bool) {
	wanted := map[string]bool{}
	for _, kind := range kinds {
		wanted[kind] = true
	}
	for _, node := range flattenQualityImportNodes(root) {
		for _, artifact := range node.Artifacts {
			if !wanted[artifact.Kind] || len(artifact.Preview) == 0 {
				continue
			}
			var value any
			if err := json.Unmarshal(artifact.Preview, &value); err == nil {
				return value, true
			}
		}
	}
	return nil, false
}

func firstNonEmptyQualityImportString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func flattenQualityImportNodes(root api.ObservabilityRunDetailNode) []api.ObservabilityRunDetailNode {
	nodes := []api.ObservabilityRunDetailNode{root}
	for _, child := range root.Children {
		nodes = append(nodes, flattenQualityImportNodes(child)...)
	}
	return nodes
}

func qualityImportSinceCutoff(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.HasSuffix(value, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(value, "d"))
		if err != nil || days < 0 {
			return nil
		}
		cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
		return &cutoff
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return nil
	}
	cutoff := time.Now().Add(-duration)
	return &cutoff
}

func normalizeQualityImportStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "ok", "success", "passed":
		return "ok"
	case "error", "failed", "fail":
		return "error"
	default:
		return strings.ToLower(strings.TrimSpace(status))
	}
}
