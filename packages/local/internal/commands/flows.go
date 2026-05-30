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
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
			var flows []api.RuntimeFlowRun
			if err := c.GetJSON(cmd.Context(), "/api/runtime-flows", &flows); err != nil {
				return err
			}

			if jsonOutput {
				return output.JSON(flows)
			}

			if len(flows) == 0 {
				fmt.Println(output.Dim.Render("No runtime flows found."))
				return nil
			}

			tbl := &output.Table{
				Headers: []string{"TIME", "NAME", "STATUS", "SESSION"},
			}

			for _, f := range flows {
				status := output.Status(f.Status)

				tbl.Rows = append(tbl.Rows, []string{
					output.Dim.Render(output.FormatTime(f.StartedAt)),
					output.Cyan.Render(f.Name),
					status,
					output.Dim.Render(truncate(f.SessionID, 16)),
				})
			}

			tbl.Print()
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}
