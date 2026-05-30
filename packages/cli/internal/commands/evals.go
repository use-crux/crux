package commands

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/cli/internal/api"
	"github.com/use-crux/crux/packages/cli/internal/cli"
	"github.com/use-crux/crux/packages/cli/internal/output"
)

// NewEvalsCmd creates the "crux evals" command for listing past eval runs.
func NewEvalsCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool

	cmd := &cobra.Command{
		Use:   "evals [id]",
		Short: "List past eval runs or show eval detail",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c := f.Client()

			if len(args) == 1 {
				return showEvalDetail(ctx, c, args[0], jsonOutput)
			}
			return listEvals(ctx, c, jsonOutput)
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

func listEvals(ctx context.Context, c *api.Client, jsonOut bool) error {
	var runs []api.EvalRun
	if err := c.GetJSON(ctx, "/api/evals", &runs); err != nil {
		return err
	}

	if jsonOut {
		return output.JSON(runs)
	}

	if len(runs) == 0 {
		fmt.Println(output.Dim.Render("No eval runs found."))
		return nil
	}

	tbl := &output.Table{
		Headers: []string{"ID", "PROMPT", "STATUS", "CASES", "PASSED", "FAILED", "DURATION"},
	}

	for _, r := range runs {
		prompt := ""
		if r.PromptID != nil {
			prompt = *r.PromptID
		}

		status := output.Yellow.Render(r.Status)
		if r.Status == "completed" {
			status = output.Green.Render(r.Status)
		}

		passed := ""
		failed := ""
		if r.Summary != nil {
			passed = output.Green.Render(fmt.Sprintf("%d", r.Summary.Passed))
			failed = fmt.Sprintf("%d", r.Summary.Failed)
			if r.Summary.Failed > 0 {
				failed = output.Red.Render(failed)
			} else {
				failed = output.Dim.Render(failed)
			}
		}

		dur := ""
		if r.DurationMs != nil {
			dur = output.FormatDuration(*r.DurationMs)
		}

		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(r.EvalID, 16)),
			prompt,
			status,
			fmt.Sprintf("%d/%d", len(r.CompletedCases), r.TotalCases),
			passed,
			failed,
			dur,
		})
	}

	tbl.Print()
	return nil
}

func showEvalDetail(ctx context.Context, c *api.Client, evalID string, jsonOut bool) error {
	if jsonOut {
		raw, err := c.GetRaw(ctx, "/api/evals/"+evalID)
		if err != nil {
			return err
		}
		fmt.Println(string(raw))
		return nil
	}

	var run api.EvalRun
	if err := c.GetJSON(ctx, "/api/evals/"+evalID, &run); err != nil {
		return err
	}

	prompt := "(anonymous)"
	if run.PromptID != nil {
		prompt = *run.PromptID
	}

	fmt.Printf("%s  %s  %s\n",
		output.Bold.Render("Eval"),
		output.BoldCyan.Render(prompt),
		output.Dim.Render(run.EvalID),
	)

	if run.Summary != nil {
		s := run.Summary
		rate := float64(0)
		if s.Total > 0 {
			rate = float64(s.Passed) / float64(s.Total)
		}
		fmt.Printf("\n  %s %d  %s %d  %s %d  %s\n",
			output.Bold.Render("Total:"), s.Total,
			output.Green.Render("Passed:"), s.Passed,
			output.Red.Render("Failed:"), s.Failed,
			output.FormatPercent(rate),
		)

		if len(s.ByModel) > 0 {
			fmt.Printf("\n  %s\n", output.Bold.Render("By Model"))
			for model, ms := range s.ByModel {
				rate := float64(0)
				if ms.Total > 0 {
					rate = float64(ms.Passed) / float64(ms.Total)
				}
				fmt.Printf("    %-25s  %d/%d  %s\n",
					output.Dim.Render(output.ShortenModel(model)),
					ms.Passed, ms.Total,
					output.FormatPercent(rate),
				)
			}
		}
	}

	// Show failed cases.
	var failures []api.EvalCaseData
	for _, ec := range run.CompletedCases {
		if !ec.Passed {
			failures = append(failures, ec)
		}
	}
	if len(failures) > 0 {
		fmt.Printf("\n  %s\n", output.Red.Render("Failures"))
		for _, f := range failures {
			errMsg := ""
			if f.Error != nil {
				errMsg = *f.Error
			}
			category := ""
			if f.FailureCategory != nil {
				category = fmt.Sprintf(" [%s]", *f.FailureCategory)
			}
			fmt.Printf("    %s %s / %s%s\n",
				output.Red.Render("✗"),
				output.Dim.Render(output.ShortenModel(f.ModelID)),
				f.CaseName,
				output.Yellow.Render(category),
			)
			if errMsg != "" {
				fmt.Printf("      %s\n", output.Dim.Render(truncate(errMsg, 80)))
			}
		}
	}

	fmt.Println()
	return nil
}
