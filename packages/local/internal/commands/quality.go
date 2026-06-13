package commands

import (
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

// NewQualityCmd is the  command group (spec 03 §1):
// run/watch/list/show/promote over the Quality engine. The pre-rewrite
// positional workbench sections (overview/suites/experiments/…) were
// deleted with the legacy read models — devtools is the workbench surface.
func NewQualityCmd(_ *cli.Factory) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "quality",
		Short: "Run and inspect quality evaluations",
	}
	cmd.AddCommand(
		NewQualityRunCmd(),
		NewQualityWatchCmd(),
		NewQualityListCmd(),
		NewQualityShowCmd(),
		NewQualityPromoteCmd(),
	)
	return cmd
}
