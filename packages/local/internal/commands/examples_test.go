package commands

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

// TestCommandsLeadWithExamples pins clig.dev R7: every user-facing command
// populates a cobra Example so `--help` leads with a realistic invocation.
func TestCommandsLeadWithExamples(t *testing.T) {
	f := &cli.Factory{}

	cmds := []*cobra.Command{
		NewCostCmd(f),
		NewIndexCmd(f),
		NewLintCmd(f),
		NewInspectCmd(f),
		NewTracesCmd(f),
		NewFlowsCmd(f),
	}
	cmds = append(cmds, NewQualityCmd(f).Commands()...)

	for _, cmd := range cmds {
		if strings.TrimSpace(cmd.Example) == "" {
			t.Errorf("command %q has no Example (clig R7: help leads with examples)", cmd.Name())
		}
	}
}
