package commands

import (
	"context"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// showTraceDetail renders one trace under a branded header. The --json branch
// preserves the raw API detail and writes it through the injected output.
func showTraceDetail(io *output.IO, ctx context.Context, c *api.Client, id string, jsonOut bool) error {
	detail, found, err := c.ObservabilityRunDetail(ctx, id)
	if err != nil {
		return err
	}
	if !found {
		runs, listErr := c.ObservabilityRuns(ctx)
		if listErr != nil {
			return listErr
		}
		for _, run := range runs {
			if run.TraceID != id {
				continue
			}
			detail, found, err = c.ObservabilityRunDetail(ctx, run.RunID)
			if err != nil {
				return err
			}
			break
		}
	}
	if !found {
		return fmt.Errorf("trace %q not found; expected a run ID or trace ID", id)
	}
	if jsonOut {
		return io.WriteJSON(detail)
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
