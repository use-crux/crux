package evalcmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func runEvals(cmd *cobra.Command, f *cli.Factory, opts runOptions, maxCostSet bool) error {
	if err := validateRunOptions(opts, maxCostSet); err != nil {
		return failBeforeExecution(f.Streams(), err.Error())
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
		io := f.Streams()
		if io.IsStderrTTY() && !io.IsCI() {
			args = append(args, "--request-unknown-cost-confirmation")
		} else {
			args = append(args, "--decline-unknown-cost-confirmation")
		}
	}
	return runCoordinator(f.Streams(), opts.cwd, args)
}

func failBeforeExecution(streams *output.IO, message string) error {
	_, _ = fmt.Fprintln(streams.Err, message)
	return domain.ExitError{Code: 2}
}
