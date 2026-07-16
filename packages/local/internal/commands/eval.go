package commands

import (
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/commands/evalcmd"
)

// NewEvalCmd creates the V3 Eval namespace alongside legacy Quality.
func NewEvalCmd(f *cli.Factory) *cobra.Command {
	return evalcmd.New(f)
}
