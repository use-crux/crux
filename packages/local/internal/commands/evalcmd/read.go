package evalcmd

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

func newShowCmd(f *cli.Factory) *cobra.Command {
	var cwd string
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:          "show <eval-run-id>",
		Short:        "Inspect a saved Eval run",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			root := resolvedRoot(cwd)
			raw, found, err := evalfs.OpenProject(root).ReadRunRaw(args[0])
			if err != nil {
				return err
			}
			if !found {
				return fmt.Errorf("Eval run %q was not found under %s", args[0], root)
			}
			if f.JSONOutput(jsonOutput) {
				return f.Streams().WriteJSON(raw)
			}
			return renderSavedRun(f.Streams().Out, raw)
		},
	}
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root containing the Eval run")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output the saved Eval run as JSON")
	return cmd
}

func newDiffCmd(f *cli.Factory) *cobra.Command {
	var cwd string
	cmd := &cobra.Command{
		Use:          "diff <run-a> <run-b>",
		Short:        "Compare two saved Eval runs",
		Args:         cobra.ExactArgs(2),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			store := evalfs.OpenProject(resolvedRoot(cwd))
			a, foundA, err := store.ReadRun(args[0])
			if err != nil {
				return err
			}
			b, foundB, err := store.ReadRun(args[1])
			if err != nil {
				return err
			}
			if !foundA || !foundB {
				return fmt.Errorf("both Eval runs must exist before diff")
			}
			if a.EvalID != b.EvalID {
				return fmt.Errorf("cannot diff Evals %q and %q; choose two runs of the same Eval", a.EvalID, b.EvalID)
			}
			return renderRunDiff(f.Streams().Out, a.Raw, b.Raw)
		},
	}
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root containing Eval runs")
	return cmd
}

type savedRunProjection struct {
	RunID      string                `json:"runId"`
	EvalID     string                `json:"evalId"`
	Status     string                `json:"status"`
	Passed     bool                  `json:"passed"`
	Cells      []savedCellProjection `json:"cells"`
	Aggregates map[string]struct {
		PassRate     float64  `json:"passRate"`
		LatencyMS    float64  `json:"latencyMs"`
		KnownCostUSD *float64 `json:"knownCostUsd"`
		Scores       map[string]struct {
			Mean float64 `json:"mean"`
		} `json:"scores"`
	} `json:"aggregates"`
}

type savedCellProjection struct {
	CaseID  string `json:"caseId"`
	Variant string `json:"variant"`
	Trial   int    `json:"trial"`
	Status  string `json:"status"`
	Task    struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	} `json:"task"`
	Scores     []scoreProjection `json:"scores"`
	Assertions struct {
		Ran      int                          `json:"ran"`
		Outcomes []assertionOutcomeProjection `json:"outcomes"`
	} `json:"assertions"`
	Metrics struct {
		DurationMS int      `json:"durationMs"`
		CostUSD    *float64 `json:"costUsd"`
	} `json:"metrics"`
	RunIDs []string `json:"runIds"`
}

type scoreProjection struct {
	Status  string   `json:"status"`
	Reason  string   `json:"reason"`
	Name    string   `json:"name"`
	Value   *float64 `json:"value"`
	Label   string   `json:"label"`
	Message string   `json:"message"`
	Work    struct {
		Status      string `json:"status"`
		Reason      string `json:"reason"`
		EvidenceRef string `json:"evidenceRef"`
		Reservation string `json:"reservation"`
	} `json:"work"`
}

type assertionOutcomeProjection struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

func decodeSavedRun(raw json.RawMessage) (savedRunProjection, error) {
	var run savedRunProjection
	if err := json.Unmarshal(raw, &run); err != nil {
		return run, fmt.Errorf("decode saved Eval run: %w", err)
	}
	return run, nil
}

func renderSavedRun(out io.Writer, raw json.RawMessage) error {
	run, err := decodeSavedRun(raw)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(out, "%s: %s passed=%t run=%s\n", run.EvalID, run.Status, run.Passed, run.RunID)
	for _, cell := range run.Cells {
		_, _ = fmt.Fprintf(out, "  %s/%s/trial-%d: %s; task %s", cell.CaseID, cell.Variant, cell.Trial+1, cell.Status, cell.Task.Status)
		if cell.Task.Reason != "" {
			_, _ = fmt.Fprintf(out, " (%s)", cell.Task.Reason)
		}
		_, _ = fmt.Fprintf(out, "; %dms", cell.Metrics.DurationMS)
		if cell.Metrics.CostUSD != nil {
			_, _ = fmt.Fprintf(out, "; $%.6f", *cell.Metrics.CostUSD)
		}
		for _, score := range cell.Scores {
			_, _ = fmt.Fprint(out, "; ")
			renderScore(out, score)
		}
		if len(cell.RunIDs) > 0 {
			_, _ = fmt.Fprintf(out, "; runs %s", strings.Join(cell.RunIDs, ", "))
		}
		_, _ = fmt.Fprintln(out)
		for _, assertion := range cell.Assertions.Outcomes {
			if assertion.Status == "failed" && assertion.Message != "" {
				_, _ = fmt.Fprintf(out, "    assertion: %s\n", assertion.Message)
			}
		}
	}
	return nil
}

func renderRunDiff(out io.Writer, rawA, rawB json.RawMessage) error {
	a, err := decodeSavedRun(rawA)
	if err != nil {
		return err
	}
	b, err := decodeSavedRun(rawB)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(out, "%s → %s (%s)\n", a.RunID, b.RunID, a.EvalID)
	armNames := make([]string, 0, len(a.Aggregates))
	for arm := range a.Aggregates {
		armNames = append(armNames, arm)
	}
	sort.Strings(armNames)
	for _, arm := range armNames {
		left, rightOK := a.Aggregates[arm]
		right, ok := b.Aggregates[arm]
		if !rightOK || !ok {
			continue
		}
		_, _ = fmt.Fprintf(out, "  %s: pass rate %+.1fpp; latency %+.0fms", arm, (right.PassRate-left.PassRate)*100, right.LatencyMS-left.LatencyMS)
		if left.KnownCostUSD != nil && right.KnownCostUSD != nil {
			_, _ = fmt.Fprintf(out, "; cost %s", formatUSDDelta(*right.KnownCostUSD-*left.KnownCostUSD))
		}
		for scorer, lscore := range left.Scores {
			if rscore, found := right.Scores[scorer]; found {
				_, _ = fmt.Fprintf(out, "; %s %+.3g", scorer, rscore.Mean-lscore.Mean)
			}
		}
		_, _ = fmt.Fprintln(out)
	}
	leftCells := map[string]savedCellProjection{}
	for _, cell := range a.Cells {
		leftCells[cell.CaseID+"/"+cell.Variant+fmt.Sprintf("/trial-%d", cell.Trial+1)] = cell
	}
	for _, cell := range b.Cells {
		key := cell.CaseID + "/" + cell.Variant + fmt.Sprintf("/trial-%d", cell.Trial+1)
		if left, found := leftCells[key]; found && left.Status != cell.Status {
			_, _ = fmt.Fprintf(out, "  %s: %s → %s\n", key, left.Status, cell.Status)
		}
	}
	return nil
}

func renderScore(out io.Writer, score scoreProjection) {
	if score.Value != nil {
		_, _ = fmt.Fprintf(out, "%s=%g", score.Name, *score.Value)
	} else if score.Label != "" {
		_, _ = fmt.Fprintf(out, "%s=%s", score.Name, score.Label)
	} else {
		_, _ = fmt.Fprintf(out, "%s %s", score.Name, score.Status)
	}
	if score.Status == "computed" || score.Status == "reused" {
		_, _ = fmt.Fprintf(out, " [%s]", score.Status)
		return
	}
	if score.Reason != "" {
		_, _ = fmt.Fprintf(out, " (%s", score.Reason)
		if score.Message != "" {
			_, _ = fmt.Fprintf(out, ": %s", score.Message)
		}
		_, _ = fmt.Fprint(out, ")")
	}
}

func formatUSDDelta(value float64) string {
	if value >= 0 {
		return fmt.Sprintf("+$%.6f", value)
	}
	return fmt.Sprintf("-$%.6f", -value)
}

func resolvedRoot(cwd string) string {
	if cwd != "" {
		return cwd
	}
	return projectroot.Dir()
}
