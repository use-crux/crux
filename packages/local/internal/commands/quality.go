package commands

import (
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/commands/qualitycmd"
)

func NewQualityCmd(f *cli.Factory) *cobra.Command {
	return qualitycmd.New(f)
}
