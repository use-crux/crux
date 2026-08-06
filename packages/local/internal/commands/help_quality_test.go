package commands

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestLiveCommandHelpDocumentsExitAndNonTTYBehavior(t *testing.T) {
	for _, test := range []struct {
		name string
		new  func(*cli.Factory) *cobra.Command
		want string
	}{
		{name: "traces", new: NewTracesCmd, want: "non-TTY output appends completed traces"},
		{name: "stats", new: NewStatsCmd, want: "non-TTY output appends full snapshots"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			factory := cli.NewFactoryWithStreams(output.NewTestIO(&stdout, &stderr, output.TestIOOptions{}))
			cmd := test.new(factory)
			cmd.SetOut(&stdout)
			cmd.SetErr(&stderr)
			cmd.SetArgs([]string{"--help"})
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{"streams until Ctrl+C", test.want, "Examples:"} {
				if !strings.Contains(stdout.String(), want) {
					t.Fatalf("help = %q, want %q", stdout.String(), want)
				}
			}
		})
	}
}
