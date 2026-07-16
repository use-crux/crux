package evalcmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

func newShowCmd() *cobra.Command {
	var cwd string
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
			_, err = fmt.Fprintln(cmd.OutOrStdout(), string(raw))
			return err
		},
	}
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root containing the Eval run")
	return cmd
}

func newDiffCmd() *cobra.Command {
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
			result, _ := json.MarshalIndent(map[string]any{
				"runA":     map[string]any{"runId": a.RunID, "evalId": a.EvalID, "status": a.Status, "passed": a.Passed},
				"runB":     map[string]any{"runId": b.RunID, "evalId": b.EvalID, "status": b.Status, "passed": b.Passed},
				"sameEval": a.EvalID == b.EvalID,
			}, "", "  ")
			_, err = fmt.Fprintln(cmd.OutOrStdout(), string(result))
			return err
		},
	}
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root containing Eval runs")
	return cmd
}

func resolvedRoot(cwd string) string {
	if cwd != "" {
		return cwd
	}
	return projectroot.Dir()
}
