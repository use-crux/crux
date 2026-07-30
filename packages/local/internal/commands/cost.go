package commands

import (
	"fmt"
	"sort"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewCostCmd creates the "crux cost" command for tracked model spend.
func NewCostCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool

	cmd := &cobra.Command{
		Use:   "cost",
		Short: "Show tracked model cost",
		Example: `  crux cost
  crux cost --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			var events []api.CostEvent
			if err := f.Client().GetJSON(cmd.Context(), "/api/cost", &events); err != nil {
				return err
			}
			if f.JSONOutput(jsonOutput) {
				return f.Streams().WriteJSON(events)
			}
			printCost(f.Streams(), events)
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

// printCost renders tracked model spend under a branded header: a total line,
// per-model and per-prompt breakdowns, and any threshold warnings. Every styled
// span funnels through io.Sprint so `--no-color`/non-TTY output stays
// byte-clean; results go to io.Out (stdout).
func printCost(io *output.IO, events []api.CostEvent) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "cost"))
	if len(events) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No cost events recorded. Install withCostTracking() in your Crux config."))
		return
	}

	report := latestCostReport(events)
	total := nestedFloat(report, "total", "cost")
	fmt.Fprintf(io.Out, "  Total: %s  Events: %s\n\n",
		io.Sprint(output.BoldCyan, output.FormatCost(total)),
		io.Sprint(output.Bold, fmt.Sprintf("%d", len(events))))

	printCostGroup(io, "By model", nestedMap(report, "byModel"))
	printCostGroup(io, "By prompt", nestedMap(report, "byPrompt"))

	for _, event := range events {
		if event.Kind != "warn" && event.Kind != "limit" {
			continue
		}
		actual := 0.0
		if event.Actual != nil {
			actual = *event.Actual
		}
		threshold := 0.0
		if event.Threshold != nil {
			threshold = *event.Threshold
		}
		label := io.Sprint(output.Yellow, "warn")
		if event.Kind == "limit" {
			label = io.Sprint(output.Red, "limit")
		}
		fmt.Fprintf(io.Out, "  %s threshold %s reached at %s\n", label, output.FormatCost(threshold), output.FormatCost(actual))
	}
}

func latestCostReport(events []api.CostEvent) map[string]any {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Report != nil {
			return events[i].Report
		}
	}
	return map[string]any{}
}

func printCostGroup(io *output.IO, title string, group map[string]any) {
	if len(group) == 0 {
		return
	}
	keys := make([]string, 0, len(group))
	for key := range group {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	fmt.Fprintf(io.Out, "%s\n", io.Sprint(output.Bold, title))
	for _, key := range keys {
		if value, ok := group[key].(map[string]any); ok {
			fmt.Fprintf(io.Out, "  %-28s %s\n", key, output.FormatCost(number(value["cost"])))
		}
	}
	fmt.Fprintln(io.Out)
}

func nestedMap(m map[string]any, key string) map[string]any {
	if value, ok := m[key].(map[string]any); ok {
		return value
	}
	return map[string]any{}
}

func nestedFloat(m map[string]any, path ...string) float64 {
	var current any = m
	for _, key := range path {
		next, ok := current.(map[string]any)
		if !ok {
			return 0
		}
		current = next[key]
	}
	return number(current)
}

func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	default:
		return 0
	}
}
