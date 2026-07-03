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

			if len(args) == 1 {
				return showTraceDetail(io, ctx, c, args[0], jsonOutput)
			}

			if live {
				return tailTraces(io, ctx, c, promptFilter, sessionFilter, jsonOutput)
			}

			return listTraces(io, ctx, c, promptFilter, sessionFilter, jsonOutput)
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
		return output.JSON(runs)
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

func tailTraces(io *output.IO, ctx context.Context, c *api.Client, promptFilter, sessionFilter string, jsonOut bool) error {
	// Connect WebSocket for live updates.
	ws, err := api.ConnectWS(c.BaseURL)
	if err != nil {
		return err
	}
	defer ws.Close()

	// Print existing traces first (non-fatal if fetch fails).
	existing, err := c.ObservabilityRuns(ctx)
	if err != nil {
		existing = nil
	}
	existing = filterObservabilityRuns(existing, promptFilter, sessionFilter)

	seenIDs := map[string]bool{}
	if !jsonOut {
		fmt.Fprintln(io.Out, brandedHeader(io, "traces")+"  "+io.Sprint(output.Dim, "(tailing — Ctrl+C to stop)"))
		fmt.Fprintln(io.Out)
	}
	for _, run := range existing {
		seenIDs[run.RunID] = true
		if jsonOut {
			output.JSON(run)
		} else {
			printObservabilityRunLine(io, run)
		}
	}

	// Listen for new events.
	ch := make(chan json.RawMessage, 100)
	go ws.ReadMessages(ch)

	for {
		select {
		case <-ctx.Done():
			return nil
		case _, ok := <-ch:
			if !ok {
				return nil
			}
			// On any event, re-fetch traces and print new ones.
			runs, err := c.ObservabilityRuns(ctx)
			if err != nil {
				continue
			}
			runs = filterObservabilityRuns(runs, promptFilter, sessionFilter)

			for _, run := range runs {
				if seenIDs[run.RunID] {
					continue
				}
				seenIDs[run.RunID] = true
				if run.Status == "running" {
					continue // Wait for completion.
				}
				if jsonOut {
					output.JSON(run)
				} else {
					printObservabilityRunLine(io, run)
				}
			}

			// Small debounce — events can arrive in bursts.
			time.Sleep(100 * time.Millisecond)
		}
	}
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

// showTraceDetail renders one trace under a branded header: identity, run
// metadata, token/cost metrics, the span tree, and attachment counts. Every
// styled span funnels through io.Sprint/io.Status so `--no-color`/non-TTY output
// stays byte-clean; the --json branch returns the raw detail unchanged.
func showTraceDetail(io *output.IO, ctx context.Context, c *api.Client, traceID string, jsonOut bool) error {
	detail, found, err := c.ObservabilityRunDetail(ctx, traceID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("not found")
	}

	if jsonOut {
		return output.JSON(detail)
	}

	prompt := "(anonymous)"
	if detail.Run.PromptID != "" {
		prompt = detail.Run.PromptID
	}
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "traces"))
	fmt.Fprintf(io.Out, "%s  %s  %s\n\n",
		io.Status(normalizeObservabilityStatus(detail.Run.Status)),
		io.Sprint(output.BoldCyan, prompt),
		io.Sprint(output.Dim, detail.Run.Model),
	)

	fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Run ID:"), detail.Run.RunID)
	if detail.Run.TraceID != "" && detail.Run.TraceID != detail.Run.RunID {
		fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Trace ID:"), detail.Run.TraceID)
	}
	fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Provider:"), detail.Run.Provider)
	fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Duration:"), output.FormatDuration(detail.Run.DurationMs))
	if sessionID := stringAttribute(detail.Run.Attributes, "sessionId", "sessionID"); sessionID != "" {
		fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Session: "), sessionID)
	}
	if errMsg := errorMessage(detail.Run.Error); errMsg != "" {
		fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, "Error:   "), io.Sprint(output.Red, errMsg))
	}

	metrics := jsonObject(detail.Run.Metrics)
	inputTokens := intMetric(metrics, "inputTokens")
	outputTokens := intMetric(metrics, "outputTokens")
	totalTokens := intMetric(metrics, "totalTokens")
	if inputTokens > 0 || outputTokens > 0 || totalTokens > 0 {
		fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Tokens"))
		if inputTokens > 0 {
			fmt.Fprintf(io.Out, "    Input:  %s\n", output.FormatTokens(inputTokens))
		}
		if outputTokens > 0 {
			fmt.Fprintf(io.Out, "    Output: %s\n", output.FormatTokens(outputTokens))
		}
		if totalTokens == 0 {
			totalTokens = inputTokens + outputTokens
		}
		fmt.Fprintf(io.Out, "    Total:  %s\n", output.FormatTokens(totalTokens))
	}

	if value, ok := floatMetric(metrics, "costUsd", "cost"); ok {
		fmt.Fprintf(io.Out, "    Cost:   %s\n", output.FormatCost(value))
	}

	if len(detail.Rows) > 0 {
		fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Spans"))
		for _, row := range detail.Rows {
			indent := strings.Repeat("  ", row.Depth)
			kind := firstNonEmptyString(row.Display.Kind, "span")
			fmt.Fprintf(io.Out, "    %s%s %-12s %-28s %8s\n",
				indent,
				io.Status(normalizeObservabilityStatus(row.Status)),
				kind,
				truncate(row.Display.Label, 28),
				output.FormatDuration(row.Timing.DurationMs),
			)
		}
	}

	if detail.Counts.AttachedDetails > 0 {
		fmt.Fprintf(io.Out, "\n  %s %d\n", io.Sprint(output.Bold, "Attached details:"), detail.Counts.AttachedDetails)
	}
	if len(detail.Diagnostics) > 0 {
		fmt.Fprintf(io.Out, "  %s %d\n", io.Sprint(output.Bold, "Diagnostics:"), len(detail.Diagnostics))
	}
	if len(detail.Facets) > 0 {
		fmt.Fprintf(io.Out, "  %s %d\n", io.Sprint(output.Bold, "Facet groups:"), len(detail.Facets))
	}

	fmt.Fprintln(io.Out)
	return nil
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
