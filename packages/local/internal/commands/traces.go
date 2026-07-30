package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewTracesCmd creates the "crux traces" command. Without arguments it lists
// recent traces in a table. With a trace ID argument it shows full detail.
// Supports --prompt and --session filters, --live for real-time tailing,
// and --json for machine-readable output.
func NewTracesCmd(f *cli.Factory) *cobra.Command {
	var promptFilter string
	var sessionFilter string
	var jsonOutput bool
	var live bool

	cmd := &cobra.Command{
		Use:   "traces [id]",
		Short: "List recent traces or show trace detail",
		Example: `  crux traces
  crux traces --prompt my.prompt.id
  crux traces --live
  crux traces <trace-id>`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c := f.Client()
			io := f.Streams()
			jsonOut := f.JSONOutput(jsonOutput)

			if len(args) == 1 {
				return showTraceDetail(io, ctx, c, args[0], jsonOut)
			}

			if live {
				return tailTraces(io, ctx, c, promptFilter, sessionFilter, jsonOut)
			}

			return listTraces(io, ctx, c, promptFilter, sessionFilter, jsonOut)
		},
	}

	cmd.Flags().StringVar(&promptFilter, "prompt", "", "Filter by prompt ID")
	cmd.Flags().StringVar(&sessionFilter, "session", "", "Filter by session ID")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().BoolVar(&live, "live", false, "Tail traces in real-time")

	return cmd
}

func listTraces(io *output.IO, ctx context.Context, c *api.Client, promptFilter, sessionFilter string, jsonOut bool) error {
	runs, err := c.ObservabilityRuns(ctx)
	if err != nil {
		return err
	}

	runs = filterObservabilityRuns(runs, promptFilter, sessionFilter)

	if jsonOut {
		return io.WriteJSON(runs)
	}

	printTraces(io, runs)
	return nil
}

// printTraces renders recent traces as a width-aware table under a branded
// header. Every styled span funnels through io.Sprint/io.Status so
// `--no-color`/non-TTY output stays byte-clean; results go to io.Out (stdout).
func printTraces(io *output.IO, runs []api.ObservabilityRunSummary) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "traces"))

	if len(runs) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No traces found."))
		return
	}

	tbl := &output.Table{
		Headers: []string{"TIME", "STATUS", "PROMPT", "MODEL", "DURATION", "TOKENS", "COST"},
	}
	for _, run := range runs {
		tbl.Rows = append(tbl.Rows, observabilityRunRow(io, run))
	}
	fmt.Fprint(io.Out, io.RenderTable(tbl))
}

func printObservabilityRunLine(io *output.IO, run api.ObservabilityRunSummary) {
	row := observabilityRunRow(io, run)
	// Simple inline print.
	fmt.Fprintf(io.Out, "%s  %s  %-20s  %-12s  %6s  %6s  %s\n",
		row[0], row[1], row[2], row[3], row[4], row[5], row[6])
}

func observabilityRunRow(io *output.IO, run api.ObservabilityRunSummary) []string {
	metrics := jsonObject(run.Metrics)
	tokens := ""
	if total := intMetric(metrics, "totalTokens"); total > 0 {
		tokens = output.FormatTokens(total)
	}
	cost := ""
	if value, ok := floatMetric(metrics, "costUsd", "cost"); ok {
		cost = output.FormatCost(value)
	}

	return []string{
		io.Sprint(output.Dim, formatObservabilityTime(run.StartedAt)),
		io.Status(normalizeObservabilityStatus(run.Status)),
		run.PromptID,
		io.Sprint(output.Dim, output.ShortenModel(run.Model)),
		output.FormatDuration(run.DurationMs),
		tokens,
		cost,
	}
}

func filterObservabilityRuns(runs []api.ObservabilityRunSummary, promptFilter, sessionFilter string) []api.ObservabilityRunSummary {
	if promptFilter == "" && sessionFilter == "" {
		return runs
	}
	filtered := make([]api.ObservabilityRunSummary, 0, len(runs))
	for _, run := range runs {
		if promptFilter != "" && run.PromptID != promptFilter {
			continue
		}
		if sessionFilter != "" && stringAttribute(run.Attributes, "sessionId", "sessionID") != sessionFilter {
			continue
		}
		filtered = append(filtered, run)
	}
	return filtered
}

func normalizeObservabilityStatus(status string) string {
	switch status {
	case "ok":
		return "success"
	case "error":
		return "failed"
	default:
		return status
	}
}

func formatObservabilityTime(value string) string {
	if value == "" {
		return ""
	}
	if ts, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return ts.Local().Format("15:04:05")
	}
	return value
}

func jsonObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	return obj
}

func intMetric(metrics map[string]any, key string) int {
	value, ok := metrics[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		return 0
	}
}

func floatMetric(metrics map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := metrics[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed, true
		case int:
			return float64(typed), true
		case json.Number:
			n, err := typed.Float64()
			return n, err == nil
		}
	}
	return 0, false
}

func stringAttribute(raw json.RawMessage, keys ...string) string {
	attrs := jsonObject(raw)
	for _, key := range keys {
		if value, ok := attrs[key].(string); ok {
			return value
		}
	}
	return ""
}

func errorMessage(raw json.RawMessage) string {
	obj := jsonObject(raw)
	if value, ok := obj["message"].(string); ok {
		return value
	}
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	return strings.TrimSpace(string(raw))
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
