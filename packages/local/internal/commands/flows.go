package commands

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewFlowsCmd creates the "crux flows" command for listing runtime flow sessions.
func NewFlowsCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool

	cmd := &cobra.Command{
		Use:   "flows",
		Short: "List runtime flow sessions",
		Example: `  crux flows
  crux flows --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
			var flows []api.RuntimeFlowRun
			if err := c.GetJSON(cmd.Context(), "/api/runtime-flows", &flows); err != nil {
				return err
			}

			if jsonOutput {
				return output.JSON(flows)
			}

			printFlows(f.Streams(), flows)
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

// printFlows renders the runtime flow sessions under a branded header. Every
// styled span funnels through io.Sprint/io.Status so `--no-color`/non-TTY output
// stays byte-clean; results go to io.Out (stdout).
func printFlows(io *output.IO, flows []api.RuntimeFlowRun) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "flows"))

	if len(flows) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No runtime flows found."))
		return
	}

	tbl := &output.Table{
		Headers: []string{"TIME", "NAME", "STATUS", "SESSION"},
	}
	for _, flow := range flows {
		tbl.Rows = append(tbl.Rows, []string{
			io.Sprint(output.Dim, output.FormatTime(flow.StartedAt)),
			io.Sprint(output.Cyan, flow.Name),
			io.Status(flow.Status),
			io.Sprint(output.Dim, truncate(flow.SessionID, 16)),
		})
	}
	fmt.Fprint(io.Out, tbl.Render())
}
