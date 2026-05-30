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
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c := f.Client()

			if len(args) == 1 {
				return showTraceDetail(ctx, c, args[0], jsonOutput)
			}

			if live {
				return tailTraces(ctx, c, promptFilter, sessionFilter, jsonOutput)
			}

			return listTraces(ctx, c, promptFilter, sessionFilter, jsonOutput)
		},
	}

	cmd.Flags().StringVar(&promptFilter, "prompt", "", "Filter by prompt ID")
	cmd.Flags().StringVar(&sessionFilter, "session", "", "Filter by session ID")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().BoolVar(&live, "live", false, "Tail traces in real-time")

	return cmd
}

func listTraces(ctx context.Context, c *api.Client, promptFilter, sessionFilter string, jsonOut bool) error {
	runs, err := c.ObservabilityRuns(ctx)
	if err != nil {
		return err
	}

	runs = filterObservabilityRuns(runs, promptFilter, sessionFilter)

	if jsonOut {
		return output.JSON(runs)
	}

	if len(runs) == 0 {
		fmt.Println(output.Dim.Render("No traces found."))
		return nil
	}

	tbl := &output.Table{
		Headers: []string{"TIME", "STATUS", "PROMPT", "MODEL", "DURATION", "TOKENS", "COST"},
	}

	for _, run := range runs {
		tbl.Rows = append(tbl.Rows, observabilityRunRow(run))
	}

	tbl.Print()
	return nil
}

func tailTraces(ctx context.Context, c *api.Client, promptFilter, sessionFilter string, jsonOut bool) error {
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
		fmt.Println(output.Bold.Render("Tailing traces...") + "  " + output.Dim.Render("(Ctrl+C to stop)"))
		fmt.Println()
	}
	for _, run := range existing {
		seenIDs[run.RunID] = true
		if jsonOut {
			output.JSON(run)
		} else {
			printObservabilityRunLine(run)
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
					printObservabilityRunLine(run)
				}
			}

			// Small debounce — events can arrive in bursts.
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func printObservabilityRunLine(run api.ObservabilityRunSummary) {
	row := observabilityRunRow(run)
	// Simple inline print.
	fmt.Printf("%s  %s  %-20s  %-12s  %6s  %6s  %s\n",
		row[0], row[1], row[2], row[3], row[4], row[5], row[6])
}

func observabilityRunRow(run api.ObservabilityRunSummary) []string {
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
		output.Dim.Render(formatObservabilityTime(run.StartedAt)),
		output.Status(normalizeObservabilityStatus(run.Status)),
		run.PromptID,
		output.Dim.Render(output.ShortenModel(run.Model)),
		output.FormatDuration(run.DurationMs),
		tokens,
		cost,
	}
}

func showTraceDetail(ctx context.Context, c *api.Client, traceID string, jsonOut bool) error {
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
	fmt.Printf("%s  %s  %s\n\n",
		output.Status(normalizeObservabilityStatus(detail.Run.Status)),
		output.BoldCyan.Render(prompt),
		output.Dim.Render(detail.Run.Model),
	)

	fmt.Printf("  %s  %s\n", output.Bold.Render("Run ID:"), detail.Run.RunID)
	if detail.Run.TraceID != "" && detail.Run.TraceID != detail.Run.RunID {
		fmt.Printf("  %s  %s\n", output.Bold.Render("Trace ID:"), detail.Run.TraceID)
	}
	fmt.Printf("  %s  %s\n", output.Bold.Render("Provider:"), detail.Run.Provider)
	fmt.Printf("  %s  %s\n", output.Bold.Render("Duration:"), output.FormatDuration(detail.Run.DurationMs))
	if sessionID := stringAttribute(detail.Run.Attributes, "sessionId", "sessionID"); sessionID != "" {
		fmt.Printf("  %s  %s\n", output.Bold.Render("Session: "), sessionID)
	}
	if errMsg := errorMessage(detail.Run.Error); errMsg != "" {
		fmt.Printf("  %s  %s\n", output.Bold.Render("Error:   "), output.Red.Render(errMsg))
	}

	metrics := jsonObject(detail.Run.Metrics)
	inputTokens := intMetric(metrics, "inputTokens")
	outputTokens := intMetric(metrics, "outputTokens")
	totalTokens := intMetric(metrics, "totalTokens")
	if inputTokens > 0 || outputTokens > 0 || totalTokens > 0 {
		fmt.Printf("\n  %s\n", output.Bold.Render("Tokens"))
		if inputTokens > 0 {
			fmt.Printf("    Input:  %s\n", output.FormatTokens(inputTokens))
		}
		if outputTokens > 0 {
			fmt.Printf("    Output: %s\n", output.FormatTokens(outputTokens))
		}
		if totalTokens == 0 {
			totalTokens = inputTokens + outputTokens
		}
		fmt.Printf("    Total:  %s\n", output.FormatTokens(totalTokens))
	}

	if value, ok := floatMetric(metrics, "costUsd", "cost"); ok {
		fmt.Printf("    Cost:   %s\n", output.FormatCost(value))
	}

	if len(detail.Rows) > 0 {
		fmt.Printf("\n  %s\n", output.Bold.Render("Spans"))
		for _, row := range detail.Rows {
			indent := strings.Repeat("  ", row.Depth)
			kind := firstNonEmptyString(row.Display.Kind, "span")
			fmt.Printf("    %s%s %-12s %-28s %8s\n",
				indent,
				output.Status(normalizeObservabilityStatus(row.Status)),
				kind,
				truncate(row.Display.Label, 28),
				output.FormatDuration(row.Timing.DurationMs),
			)
		}
	}

	if detail.Counts.AttachedDetails > 0 {
		fmt.Printf("\n  %s %d\n", output.Bold.Render("Attached details:"), detail.Counts.AttachedDetails)
	}
	if len(detail.Diagnostics) > 0 {
		fmt.Printf("  %s %d\n", output.Bold.Render("Diagnostics:"), len(detail.Diagnostics))
	}
	if len(detail.Facets) > 0 {
		fmt.Printf("  %s %d\n", output.Bold.Render("Facet groups:"), len(detail.Facets))
	}

	fmt.Println()
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
