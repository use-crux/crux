// Package evalcmd owns the new V3 `crux eval` command namespace.
package evalcmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

type runOptions struct {
	cwd       string
	selectors []string
	cases     []string
	variants  []string
	watch     bool
	fresh     bool
	offline   bool
	plan      bool
	maxCost   float64
}

// New creates the Eval V1 command group.
func New(f *cli.Factory) *cobra.Command {
	opts := &runOptions{}
	cmd := &cobra.Command{
		Use:   "eval [selector...]",
		Short: "Run Evals and inspect Eval runs and Baselines",
		Long: `Eval discovers one default Eval per *.eval.ts file and runs Current
plus declared Variants with exact reuse, explicit Baselines, and actionable
preflight errors.`,
		Example: `  crux eval
  crux eval support
  crux eval support --case refund --variant cheaper
  crux eval list
  crux eval baseline set <run-id>`,
		Args:          cobra.ArbitraryArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.selectors = args
			return runEvals(cmd, f, *opts, cmd.Flags().Changed("max-cost"))
		},
	}
	registerRunFlags(cmd, opts)
	cmd.AddCommand(newRunCmd(f), newListCmd(), newShowCmd(), newDiffCmd(), newBaselineCmd())
	return cmd
}

func registerRunFlags(cmd *cobra.Command, opts *runOptions) {
	cmd.Flags().StringVar(&opts.cwd, "cwd", "", "Working directory for Eval discovery")
	cmd.Flags().StringArrayVar(&opts.cases, "case", nil, "Select a Case id/name; repeatable")
	cmd.Flags().StringArrayVar(&opts.variants, "variant", nil, "Run Current plus this blocking Variant; repeatable")
	cmd.Flags().BoolVar(&opts.watch, "watch", false, "Replan affected Evals when source changes")
	cmd.Flags().BoolVar(&opts.fresh, "fresh", false, "Bypass reusable task and managed-scorer evidence")
	cmd.Flags().BoolVar(&opts.offline, "offline", false, "Require exact external evidence before all work")
	cmd.Flags().BoolVar(&opts.plan, "plan", false, "Print admitted actions without execution or writes")
	cmd.Flags().Float64Var(&opts.maxCost, "max-cost", 0, "Maximum admitted external cost in USD")
}

func newRunCmd(f *cli.Factory) *cobra.Command {
	opts := &runOptions{}
	cmd := &cobra.Command{
		Use:          "run [selector...]",
		Short:        "Run discovered Evals",
		Args:         cobra.ArbitraryArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.selectors = args
			return runEvals(cmd, f, *opts, cmd.Flags().Changed("max-cost"))
		},
	}
	registerRunFlags(cmd, opts)
	return cmd
}

func newListCmd() *cobra.Command {
	var cwd string
	cmd := &cobra.Command{
		Use:          "list",
		Short:        "List discovered Evals",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCoordinator(cmd, cwd, []string{"--list"})
		},
	}
	cmd.Flags().StringVar(&cwd, "cwd", "", "Working directory for Eval discovery")
	return cmd
}

func newBaselineCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "baseline", Short: "Manage accepted Eval Baselines"}
	var cwd, variant string
	set := &cobra.Command{
		Use:          "set <run-id>",
		Short:        "Set a complete Eval run arm as Baseline",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(command *cobra.Command, args []string) error {
			workerArgs := []string{"--baseline-set", args[0]}
			if variant != "" {
				workerArgs = append(workerArgs, "--variant", variant)
			}
			return runCoordinator(command, cwd, workerArgs)
		},
	}
	set.Flags().StringVar(&cwd, "cwd", "", "Working directory containing the Eval run")
	set.Flags().StringVar(&variant, "variant", "current", "Complete arm to accept")
	cmd.AddCommand(set)
	return cmd
}

func validateRunOptions(opts runOptions, maxCostSet bool) error {
	if maxCostSet && opts.maxCost < 0 {
		return fmt.Errorf("--max-cost must be non-negative")
	}
	if opts.watch && opts.plan {
		return fmt.Errorf("--watch and --plan cannot be combined")
	}
	return nil
}
