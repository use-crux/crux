package evalcmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
)

func runEvals(cmd *cobra.Command, f *cli.Factory, opts runOptions, maxCostSet bool) error {
	if err := validateRunOptions(opts, maxCostSet); err != nil {
		return failBeforeExecution(cmd, err.Error())
	}
	if opts.watch {
		opts.watch = false
		return runEvalWatch(cmd, f, opts, maxCostSet)
	}
	args := append([]string{}, opts.selectors...)
	for _, value := range opts.cases {
		args = append(args, "--case", value)
	}
	for _, value := range opts.variants {
		args = append(args, "--variant", value)
	}
	if opts.fresh {
		args = append(args, "--fresh")
	}
	if opts.offline {
		args = append(args, "--offline")
	}
	if opts.plan {
		args = append(args, "--plan")
	}
	if maxCostSet {
		args = append(args, "--max-cost", fmt.Sprint(opts.maxCost))
	}
	if !opts.plan && !maxCostSet {
		needsConfirmation, blocked, err := inspectAdmission(opts.cwd, args)
		if err != nil {
			return failBeforeExecution(cmd, err.Error())
		}
		if needsConfirmation && !blocked {
			io := f.Streams()
			if !io.IsStderrTTY() || io.IsCI() {
				return failBeforeExecution(cmd, "Eval has unknown external cost and requires interactive confirmation; run --plan to inspect actions or configure pricing for --max-cost")
			}
			confirmed, err := confirmUnknownCost(cmd)
			if err != nil {
				return failBeforeExecution(cmd, err.Error())
			}
			if !confirmed {
				return failBeforeExecution(cmd, "Eval cost confirmation declined; no external calls were made")
			}
			args = append(args, "--confirm-unknown-cost")
		}
	}
	return runCoordinator(cmd, opts.cwd, args)
}

func failBeforeExecution(cmd *cobra.Command, message string) error {
	_, _ = fmt.Fprintln(cmd.Root().ErrOrStderr(), message)
	return domain.ExitError{Code: 2}
}
