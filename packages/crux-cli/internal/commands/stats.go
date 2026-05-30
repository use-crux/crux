package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/cli"
	"github.com/anthropics/crux-cli/internal/output"
	"github.com/spf13/cobra"
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

			if live {
				return liveStats(ctx, c, jsonOutput)
			}

			var stats api.Stats
			if err := c.GetJSON(ctx, "/api/stats", &stats); err != nil {
				return err
			}

			if jsonOutput {
				return output.JSON(stats)
			}

			printStats(stats)

			var usage map[string]api.PromptUsageStat
			if err := c.GetJSON(ctx, "/api/stats/prompt-usage", &usage); err == nil && len(usage) > 0 {
				printPromptUsage(usage)
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().BoolVar(&live, "live", false, "Continuously update stats")
	return cmd
}

func liveStats(ctx context.Context, c *api.Client, jsonOut bool) error {
	ws, err := api.ConnectWS(c.BaseURL)
	if err != nil {
		return err
	}
	defer ws.Close()

	ch := make(chan json.RawMessage, 100)
	go ws.ReadMessages(ch)

	// Print initial stats.
	refreshStats(ctx, c, jsonOut)

	for {
		select {
		case <-ctx.Done():
			return nil
		case _, ok := <-ch:
			if !ok {
				return nil
			}
			if !jsonOut {
				// Clear screen and reprint.
				fmt.Print("\033[H\033[2J")
			}
			refreshStats(ctx, c, jsonOut)
			time.Sleep(200 * time.Millisecond)
		}
	}
}

func refreshStats(ctx context.Context, c *api.Client, jsonOut bool) {
	var stats api.Stats
	if err := c.GetJSON(ctx, "/api/stats", &stats); err != nil {
		return
	}
	if jsonOut {
		output.JSON(stats)
		return
	}
	printStats(stats)
	var usage map[string]api.PromptUsageStat
	if err := c.GetJSON(ctx, "/api/stats/prompt-usage", &usage); err == nil && len(usage) > 0 {
		printPromptUsage(usage)
	}
	fmt.Println(output.Dim.Render("  Live — updates on new events. Ctrl+C to stop."))
}

func printStats(s api.Stats) {
	fmt.Printf("%s\n\n", output.Bold.Render("Overview"))

	// Execution stats.
	fmt.Printf("  Executions: %s  ", output.BoldCyan.Render(fmt.Sprintf("%d", s.TotalExecutions)))
	fmt.Printf("%s %d  ", output.Green.Render("✓"), s.SuccessCount)
	fmt.Printf("%s %d  ", output.Red.Render("✗"), s.ErrorCount)
	if s.RunningCount > 0 {
		fmt.Printf("%s %d", output.Yellow.Render("●"), s.RunningCount)
	}
	fmt.Println()

	if s.TotalExecutions > 0 {
		fmt.Printf("  Avg duration: %s\n", output.FormatDuration(s.AvgDurationMs))
		if s.ErrorRate > 0 {
			fmt.Printf("  Error rate:   %s\n", output.Red.Render(output.FormatPercent(s.ErrorRate)))
		}
	}

	// Cost & tokens.
	fmt.Printf("\n  Tokens: %s  Cost: %s\n",
		output.BoldCyan.Render(output.FormatTokens(s.TotalTokens)),
		output.BoldCyan.Render(output.FormatCost(s.TotalCost)),
	)
	if s.TotalExecutions > 0 {
		fmt.Printf("  Avg cost: %s/call\n", output.FormatCost(s.AvgCost))
	}

	// Streaming.
	if s.StreamingTraceCount > 0 {
		fmt.Printf("\n  Streaming: %d traces", s.StreamingTraceCount)
		if s.AvgTtftMs != nil {
			fmt.Printf("  Avg TTFT: %s", output.FormatDuration(*s.AvgTtftMs))
		}
		if s.AvgThroughput != nil {
			fmt.Printf("  Avg throughput: %.0f tok/s", *s.AvgThroughput)
		}
		fmt.Println()
	}

	// Memory & budget.
	if s.MemoryReadCount+s.MemoryWriteCount > 0 {
		fmt.Printf("\n  Memory: %d reads, %d writes\n", s.MemoryReadCount, s.MemoryWriteCount)
	}
	if s.EmbeddingCallCount > 0 {
		fmt.Printf("  Embeddings: %d calls, %d texts\n", s.EmbeddingCallCount, s.TotalEmbeddingTexts)
		if s.AvgEmbeddingDurationMs != nil || s.TotalEmbeddingTokens > 0 || s.TotalEmbeddingCost > 0 {
			fmt.Print("    ")
			if s.AvgEmbeddingDurationMs != nil {
				fmt.Printf("Avg: %s", output.FormatDuration(*s.AvgEmbeddingDurationMs))
			}
			if s.TotalEmbeddingTokens > 0 {
				fmt.Printf("  Tokens: %s", output.FormatTokens(s.TotalEmbeddingTokens))
			}
			if s.TotalEmbeddingCost > 0 {
				fmt.Printf("  Cost: %s", output.FormatCost(s.TotalEmbeddingCost))
			}
			fmt.Println()
		}
		if s.EmbeddingCacheHitCount+s.EmbeddingCacheMissCount+s.EmbeddingRetryCount+s.EmbeddingTruncatedCount > 0 {
			fmt.Printf(
				"    Governance: %d cache hits, %d cache misses, %d retries, %d truncated\n",
				s.EmbeddingCacheHitCount,
				s.EmbeddingCacheMissCount,
				s.EmbeddingRetryCount,
				s.EmbeddingTruncatedCount,
			)
		}
	}
	if s.RetrievalCallCount > 0 {
		fmt.Printf("  Retrievals: %d calls, %d hits\n", s.RetrievalCallCount, s.TotalRetrievedHits)
		if s.AvgRetrievalDurationMs != nil || s.RetrievalErrorCount > 0 {
			fmt.Print("    ")
			if s.AvgRetrievalDurationMs != nil {
				fmt.Printf("Avg: %s", output.FormatDuration(*s.AvgRetrievalDurationMs))
			}
			if s.RetrievalErrorCount > 0 {
				fmt.Printf("  Errors: %s", output.Red.Render(fmt.Sprintf("%d", s.RetrievalErrorCount)))
			}
			fmt.Println()
		}
		if s.RetrievalStageCount > 0 {
			fmt.Printf("    Pipeline stages: %d", s.RetrievalStageCount)
			if s.RetrievalStageErrorCount > 0 {
				fmt.Printf("  Errors: %s", output.Red.Render(fmt.Sprintf("%d", s.RetrievalStageErrorCount)))
			}
			fmt.Println()
		}
	}
	if s.WorkspaceOperationCount > 0 {
		fmt.Printf("  Workspace ops: %d", s.WorkspaceOperationCount)
		if s.WorkspaceErrorCount > 0 {
			fmt.Printf("  Errors: %s", output.Red.Render(fmt.Sprintf("%d", s.WorkspaceErrorCount)))
		}
		fmt.Println()
	}
	if s.IndexOperationCount > 0 {
		fmt.Printf("  Indexing: %d ops, %d sources, %d chunks\n",
			s.IndexOperationCount, s.TotalIndexedSources, s.TotalIndexedChunks)
		if s.AvgIndexDurationMs != nil || s.IndexErrorCount > 0 {
			fmt.Print("    ")
			if s.AvgIndexDurationMs != nil {
				fmt.Printf("Avg: %s", output.FormatDuration(*s.AvgIndexDurationMs))
			}
			if s.IndexErrorCount > 0 {
				fmt.Printf("  Errors: %s", output.Red.Render(fmt.Sprintf("%d", s.IndexErrorCount)))
			}
			fmt.Println()
		}
	}
	if s.CompactionCount > 0 {
		fmt.Printf("  Compactions: %d\n", s.CompactionCount)
	}
	if s.BudgetLevel != nil {
		label := *s.BudgetLevel
		switch label {
		case "warning":
			label = output.Yellow.Render(label)
		case "critical":
			label = output.Red.Render(label)
		default:
			label = output.Green.Render(label)
		}
		fmt.Printf("  Budget: %s\n", label)
	}

	// Agent coordination.
	if s.HandoffCount+s.DelegateCount+s.BlackboardUpdateCount > 0 {
		fmt.Printf("\n  Handoffs: %d  Delegates: %d  Blackboard updates: %d\n",
			s.HandoffCount, s.DelegateCount, s.BlackboardUpdateCount)
	}

	// Tools.
	if s.ToolExecutionCount+s.ToolApprovalRequestCount > 0 {
		fmt.Printf("\n  Tool calls: %d", s.ToolExecutionCount)
		if s.ToolApprovalRequestCount > 0 {
			fmt.Printf("  approvals: %d", s.ToolApprovalRequestCount)
			if s.ToolApprovalDeniedCount > 0 {
				fmt.Printf(" (%d denied)", s.ToolApprovalDeniedCount)
			}
		}
		if s.ToolErrorCount > 0 {
			fmt.Printf("  (%s errors)", output.Red.Render(fmt.Sprintf("%d", s.ToolErrorCount)))
		}
		if s.ToolTokenSavingsEstimate > 0 {
			fmt.Printf("  shaped -%dB", s.ToolTokenSavingsEstimate)
		}
		fmt.Println()
	}

	// Security.
	if s.SecurityWarningCount > 0 {
		fmt.Printf("\n  %s: %s\n", output.Red.Render("Security warnings"), output.Red.Render(fmt.Sprintf("%d", s.SecurityWarningCount)))
	}

	fmt.Println()
}

func printPromptUsage(usage map[string]api.PromptUsageStat) {
	fmt.Printf("%s\n\n", output.Bold.Render("Prompt Usage"))

	tbl := &output.Table{
		Headers: []string{"PROMPT", "CALLS", "ERRORS", "AVG DURATION", "TOTAL COST"},
	}

	for promptID, stat := range usage {
		errors := ""
		if stat.ErrorCount > 0 {
			errors = output.Red.Render(fmt.Sprintf("%d", stat.ErrorCount))
		} else {
			errors = output.Dim.Render("0")
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Cyan.Render(promptID),
			fmt.Sprintf("%d", stat.Count),
			errors,
			output.FormatDuration(stat.AvgDurationMs),
			output.FormatCost(stat.TotalCost),
		})
	}

	tbl.Print()
}
