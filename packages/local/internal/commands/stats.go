package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewStatsCmd creates the "crux stats" command for showing aggregate statistics.
func NewStatsCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var live bool

	cmd := &cobra.Command{
		Use:   "stats",
		Short: "Show aggregate statistics",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c := f.Client()
			jsonOut := f.JSONOutput(jsonOutput)

			if live {
				return liveStats(ctx, c, f.Streams(), jsonOut)
			}

			var stats api.Stats
			if err := c.GetJSON(ctx, "/api/stats", &stats); err != nil {
				return err
			}

			if jsonOut {
				return f.Streams().WriteJSON(stats)
			}

			io := f.Streams()
			printStats(io, stats)

			var usage map[string]api.PromptUsageStat
			if err := c.GetJSON(ctx, "/api/stats/prompt-usage", &usage); err == nil && len(usage) > 0 {
				printPromptUsage(io, usage)
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().BoolVar(&live, "live", false, "Continuously update stats")
	return cmd
}

func liveStats(ctx context.Context, c *api.Client, io *output.IO, jsonOut bool) error {
	ws, err := api.ConnectWS(c.BaseURL)
	if err != nil {
		return err
	}
	defer ws.Close()

	ch := make(chan json.RawMessage, 100)
	go ws.ReadMessages(ch)

	// Print initial stats.
	if err := refreshStats(ctx, c, io, jsonOut); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case _, ok := <-ch:
			if !ok {
				return nil
			}
			if !jsonOut && io.IsStdoutTTY() {
				io.ClearScreen()
			}
			if err := refreshStats(ctx, c, io, jsonOut); err != nil {
				return err
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
}

func refreshStats(ctx context.Context, c *api.Client, io *output.IO, jsonOut bool) error {
	var stats api.Stats
	if err := c.GetJSON(ctx, "/api/stats", &stats); err != nil {
		return nil
	}
	if jsonOut {
		return io.WriteJSON(stats)
	}
	printStats(io, stats)
	var usage map[string]api.PromptUsageStat
	if err := c.GetJSON(ctx, "/api/stats/prompt-usage", &usage); err == nil && len(usage) > 0 {
		printPromptUsage(io, usage)
	}
	fmt.Fprintln(io.Out, io.Sprint(output.Dim, "  Live — updates on new events. Ctrl+C to stop."))
	return nil
}

func printStats(io *output.IO, s api.Stats) {
	printf := func(format string, args ...any) { fmt.Fprintf(io.Out, format, args...) }
	println := func(args ...any) { fmt.Fprintln(io.Out, args...) }
	print := func(args ...any) { fmt.Fprint(io.Out, args...) }
	style := func(st lipgloss.Style, text string) string { return io.Sprint(st, text) }

	printf("%s\n\n", style(output.Bold, "Overview"))

	// Execution stats.
	printf("  Executions: %s  ", style(output.BoldCyan, fmt.Sprintf("%d", s.TotalExecutions)))
	printf("%s %d  ", style(output.Green, "✓"), s.SuccessCount)
	printf("%s %d  ", style(output.Red, "✗"), s.ErrorCount)
	if s.RunningCount > 0 {
		printf("%s %d", style(output.Yellow, "●"), s.RunningCount)
	}
	println()

	if s.TotalExecutions > 0 {
		printf("  Avg duration: %s\n", output.FormatDuration(s.AvgDurationMs))
		if s.ErrorRate > 0 {
			printf("  Error rate:   %s\n", style(output.Red, output.FormatPercent(s.ErrorRate)))
		}
	}

	// Cost & tokens.
	printf("\n  Tokens: %s  Cost: %s\n",
		style(output.BoldCyan, output.FormatTokens(s.TotalTokens)),
		style(output.BoldCyan, output.FormatCost(s.TotalCost)),
	)
	if s.TotalExecutions > 0 {
		printf("  Avg cost: %s/call\n", output.FormatCost(s.AvgCost))
	}

	// Streaming.
	if s.StreamingTraceCount > 0 {
		printf("\n  Streaming: %d traces", s.StreamingTraceCount)
		if s.AvgTtftMs != nil {
			printf("  Avg TTFT: %s", output.FormatDuration(*s.AvgTtftMs))
		}
		if s.AvgThroughput != nil {
			printf("  Avg throughput: %.0f tok/s", *s.AvgThroughput)
		}
		println()
	}

	// Memory & budget.
	if s.MemoryReadCount+s.MemoryWriteCount > 0 {
		printf("\n  Memory: %d reads, %d writes\n", s.MemoryReadCount, s.MemoryWriteCount)
	}
	if s.EmbeddingCallCount > 0 {
		printf("  Embeddings: %d calls, %d texts\n", s.EmbeddingCallCount, s.TotalEmbeddingTexts)
		if s.AvgEmbeddingDurationMs != nil || s.TotalEmbeddingTokens > 0 || s.TotalEmbeddingCost > 0 {
			print("    ")
			if s.AvgEmbeddingDurationMs != nil {
				printf("Avg: %s", output.FormatDuration(*s.AvgEmbeddingDurationMs))
			}
			if s.TotalEmbeddingTokens > 0 {
				printf("  Tokens: %s", output.FormatTokens(s.TotalEmbeddingTokens))
			}
			if s.TotalEmbeddingCost > 0 {
				printf("  Cost: %s", output.FormatCost(s.TotalEmbeddingCost))
			}
			println()
		}
		if s.EmbeddingCacheHitCount+s.EmbeddingCacheMissCount+s.EmbeddingRetryCount+s.EmbeddingTruncatedCount > 0 {
			printf(
				"    Governance: %d cache hits, %d cache misses, %d retries, %d truncated\n",
				s.EmbeddingCacheHitCount,
				s.EmbeddingCacheMissCount,
				s.EmbeddingRetryCount,
				s.EmbeddingTruncatedCount,
			)
		}
	}
	if s.RetrievalCallCount > 0 {
		printf("  Retrievals: %d calls, %d hits\n", s.RetrievalCallCount, s.TotalRetrievedHits)
		if s.AvgRetrievalDurationMs != nil || s.RetrievalErrorCount > 0 {
			print("    ")
			if s.AvgRetrievalDurationMs != nil {
				printf("Avg: %s", output.FormatDuration(*s.AvgRetrievalDurationMs))
			}
			if s.RetrievalErrorCount > 0 {
				printf("  Errors: %s", style(output.Red, fmt.Sprintf("%d", s.RetrievalErrorCount)))
			}
			println()
		}
		if s.RetrievalStageCount > 0 {
			printf("    Pipeline stages: %d", s.RetrievalStageCount)
			if s.RetrievalStageErrorCount > 0 {
				printf("  Errors: %s", style(output.Red, fmt.Sprintf("%d", s.RetrievalStageErrorCount)))
			}
			println()
		}
	}
	if s.WorkspaceOperationCount > 0 {
		printf("  Workspace ops: %d", s.WorkspaceOperationCount)
		if s.WorkspaceErrorCount > 0 {
			printf("  Errors: %s", style(output.Red, fmt.Sprintf("%d", s.WorkspaceErrorCount)))
		}
		println()
	}
	if s.IndexOperationCount > 0 {
		printf("  Indexing: %d ops, %d sources, %d chunks\n",
			s.IndexOperationCount, s.TotalIndexedSources, s.TotalIndexedChunks)
		if s.AvgIndexDurationMs != nil || s.IndexErrorCount > 0 {
			print("    ")
			if s.AvgIndexDurationMs != nil {
				printf("Avg: %s", output.FormatDuration(*s.AvgIndexDurationMs))
			}
			if s.IndexErrorCount > 0 {
				printf("  Errors: %s", style(output.Red, fmt.Sprintf("%d", s.IndexErrorCount)))
			}
			println()
		}
	}
	if s.CompactionCount > 0 {
		printf("  Compactions: %d\n", s.CompactionCount)
	}
	if s.BudgetLevel != nil {
		label := *s.BudgetLevel
		switch label {
		case "warning":
			label = style(output.Yellow, label)
		case "critical":
			label = style(output.Red, label)
		default:
			label = style(output.Green, label)
		}
		printf("  Budget: %s\n", label)
	}

	// Agent coordination.
	if s.HandoffCount+s.DelegateCount+s.BlackboardUpdateCount > 0 {
		printf("\n  Handoffs: %d  Delegates: %d  Blackboard updates: %d\n",
			s.HandoffCount, s.DelegateCount, s.BlackboardUpdateCount)
	}

	// Tools.
	if s.ToolExecutionCount+s.ToolApprovalRequestCount > 0 {
		printf("\n  Tool calls: %d", s.ToolExecutionCount)
		if s.ToolApprovalRequestCount > 0 {
			printf("  approvals: %d", s.ToolApprovalRequestCount)
			if s.ToolApprovalDeniedCount > 0 {
				printf(" (%d denied)", s.ToolApprovalDeniedCount)
			}
		}
		if s.ToolErrorCount > 0 {
			printf("  (%s errors)", style(output.Red, fmt.Sprintf("%d", s.ToolErrorCount)))
		}
		if s.ToolTokenSavingsEstimate > 0 {
			printf("  shaped -%dB", s.ToolTokenSavingsEstimate)
		}
		println()
	}

	// Security.
	if s.SecurityWarningCount > 0 {
		printf("\n  %s: %s\n", style(output.Red, "Security warnings"), style(output.Red, fmt.Sprintf("%d", s.SecurityWarningCount)))
	}

	println()
}

func printPromptUsage(io *output.IO, usage map[string]api.PromptUsageStat) {
	fmt.Fprintf(io.Out, "%s\n\n", io.Sprint(output.Bold, "Prompt Usage"))

	tbl := &output.Table{
		Headers: []string{"PROMPT", "CALLS", "ERRORS", "AVG DURATION", "TOTAL COST"},
	}

	for promptID, stat := range usage {
		errors := ""
		if stat.ErrorCount > 0 {
			errors = io.Sprint(output.Red, fmt.Sprintf("%d", stat.ErrorCount))
		} else {
			errors = io.Sprint(output.Dim, "0")
		}
		tbl.Rows = append(tbl.Rows, []string{
			io.Sprint(output.Cyan, promptID),
			fmt.Sprintf("%d", stat.Count),
			errors,
			output.FormatDuration(stat.AvgDurationMs),
			output.FormatCost(stat.TotalCost),
		})
	}

	fmt.Fprint(io.Out, io.RenderTable(tbl))
}
