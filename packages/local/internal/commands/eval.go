package commands

import (
	"github.com/spf13/cobra"
)

// NewEvalCmd creates "crux eval" — an undocumented argv-forwarding alias for
// `crux quality run` (spec 03 §1; help is Quality-branded).
func NewEvalCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "eval",
		Short:              "Run quality evaluations (alias for `crux quality run`)",
		Hidden:             true,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			run := NewQualityRunCmd()
			run.SetArgs(args)
			return run.Execute()
		},
	}
}
